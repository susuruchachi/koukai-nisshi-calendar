// --- ✅ タスク・🧭 長期の計画（目標）・🔔 アラーム ---
// 依存: date-utils.js (todayKey, addDaysToKey, parseDateKey, generateId)
// ・この端末の中：localStorage の koukai-nisshi-tasks / koukai-nisshi-goals = { id: 中身 }（消したものは { deleted: true, at } のまま残して、ほかの端末に知らせる）
// ・同期がオンなら Firestore の susuru_anki_cal/{uid} の tasks / goals に、1つずつ新しい方（at が大きい方）を使って入れる（sync.js の attachMap）
//
// タスク：{ id, title, due: 'YYYY-MM-DD' か '', dueTime: 'HH:MM' か '', done, doneAt, alarm: 何分前に鳴らすか（null＝鳴らさない）, notes, goalId, at }
// 目標　：{ id, title, start: 'YYYY-MM-DD', end: 'YYYY-MM-DD'（期限）, notes, at }
//         目標のステップ（中間の区切り）は、goalId を付けたタスク

const TASKS_KEY = 'koukai-nisshi-tasks';
const GOALS_KEY = 'koukai-nisshi-goals';
const ALARM_FIRED_KEY = 'koukai-nisshi-alarm-fired';

// アラームを鳴らす時刻（期限の何分前）
const ALARM_CHOICES = [
  [null, '鳴らさない'],
  [0, '期限の時刻'],
  [5, '5分前'],
  [10, '10分前'],
  [30, '30分前'],
  [60, '1時間前'],
  [180, '3時間前'],
  [1440, '1日前'],
];
const ALARM_DEFAULT_TIME = '09:00'; // 時刻の無いタスクは、この時刻を期限とみる

function loadMap(key) {
  try { const m = JSON.parse(window.localStorage.getItem(key) || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; }
}
function saveMap(key, map) {
  try { window.localStorage.setItem(key, JSON.stringify(map)); return true; } catch (e) { return false; }
}
const liveList = (map) => Object.entries(map || {}).filter(([, v]) => v && !v.deleted).map(([id, v]) => ({ ...v, id }));

function emptyTask(due) {
  return { id: null, title: '', due: due || '', dueTime: '', done: false, alarm: null, notes: '', goalId: '' };
}
function emptyGoal() {
  const t = todayKey();
  return { id: null, title: '', start: t, end: addDaysToKey(t, 90), notes: '' };
}

function daysFromTo(a, b) {
  const x = parseDateKey(a), y = parseDateKey(b);
  return Math.round((new Date(y.year, y.month, y.day) - new Date(x.year, x.month, x.day)) / 86400000);
}
function leftLabel(n) { return n === 0 ? '今日' : n === 1 ? '明日' : n > 1 ? `あと${n}日` : `${-n}日過ぎ`; }

// タスクの期限の時刻（ミリ秒）。期限が無ければ 0
function taskDueMs(t) {
  if (!t.due) return 0;
  const { year, month, day } = parseDateKey(t.due);
  const [h, m] = (t.dueTime || ALARM_DEFAULT_TIME).split(':').map(Number);
  return new Date(year, month, day, h, m, 0).getTime();
}

// 一覧のまとまり
const TASK_GROUPS = [
  ['overdue', '⚠️ 期限切れ'], ['today', '今日'], ['tomorrow', '明日'], ['week', '今週（7日以内）'],
  ['later', 'それより先'], ['none', '期限なし'], ['done', '✅ 完了'],
];
function taskGroup(t, today) {
  if (t.done) return 'done';
  if (!t.due) return 'none';
  const n = daysFromTo(today, t.due);
  if (n < 0 || (n === 0 && t.dueTime && taskDueMs(t) < Date.now())) return 'overdue';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n <= 7) return 'week';
  return 'later';
}
function sortTasks(list) {
  return list.slice().sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done) return (b.doneAt || 0) - (a.doneAt || 0);
    if (!a.due !== !b.due) return a.due ? -1 : 1;
    return (a.due || '').localeCompare(b.due || '') || (a.dueTime || '99').localeCompare(b.dueTime || '99') || (a.at || 0) - (b.at || 0);
  });
}
function taskDueText(t, today) {
  if (!t.due) return '';
  const n = daysFromTo(today, t.due);
  return `${leftLabel(n)}${t.dueTime ? ' ' + t.dueTime : ''}`;
}

// 目標の進み具合：done/total（ステップ）と、時間の過ぎた割合。ステップが時間より遅れていたら behind
function goalProgress(goal, tasks, today) {
  const steps = tasks.filter((t) => t.goalId === goal.id);
  const done = steps.filter((t) => t.done).length;
  const total = steps.length;
  const span = Math.max(1, daysFromTo(goal.start, goal.end));
  const elapsed = Math.min(1, Math.max(0, daysFromTo(goal.start, today) / span));
  const ratio = total ? done / total : 0;
  const left = daysFromTo(today, goal.end);
  let pace = '';
  if (total) {
    if (done === total) pace = 'done';
    else if (ratio + 0.1 < elapsed) pace = 'behind';
    else if (ratio > elapsed + 0.1) pace = 'ahead';
    else pace = 'ontrack';
  }
  return { steps, done, total, ratio, elapsed, left, pace };
}
const PACE_LABELS = { done: '🎉 達成', behind: '⚠️ 遅れ気味', ahead: '🚀 予定より早い', ontrack: '✅ 予定どおり' };

// 逆算して区切る：今日（か はじめの日）から期限までを、毎月・毎週・n個に分けたチェックポイントの日付
function splitCheckpoints(start, end, mode, count) {
  const from = start > todayKey() ? start : todayKey();
  const out = [];
  if (end <= from) return [end];
  if (mode === 'monthly' || mode === 'weekly') {
    let k = from;
    for (let g = 0; g < 120; g++) {
      if (mode === 'weekly') k = addDaysToKey(k, 7);
      else {
        const p = parseDateKey(k);
        // 次の月の同じ日（無い日は月末）
        const last = new Date(p.year, p.month + 2, 0).getDate();
        const d = new Date(p.year, p.month + 1, Math.min(parseDateKey(from).day, last));
        k = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
      }
      if (k >= end) break;
      out.push(k);
    }
    // 期限のすぐ前のチェックポイントは、期限とまとめる（毎月なら10日、毎週なら3日より近いとき）
    if (out.length && daysFromTo(out[out.length - 1], end) < (mode === 'monthly' ? 10 : 3)) out.pop();
    out.push(end);
    return out;
  }
  const n = Math.max(1, Math.min(52, parseInt(count, 10) || 4));
  const span = daysFromTo(from, end);
  for (let i = 1; i <= n; i++) out.push(i === n ? end : addDaysToKey(from, Math.round((span * i) / n)));
  return [...new Set(out)];
}

// アラームの一覧（これから鳴るもの。60日先まで・100件まで）：[{ id, at: ミリ秒, title, body }]
function alarmList(tasks, goals) {
  const now = Date.now(), until = now + 60 * 86400000, out = [];
  const goalName = Object.fromEntries((goals || []).map((g) => [g.id, g.title]));
  (tasks || []).forEach((t) => {
    if (t.done || !t.due || t.alarm === null || t.alarm === undefined || t.alarm === '') return;
    const at = taskDueMs(t) - Number(t.alarm) * 60000;
    if (at <= now - 60000 || at > until) return;
    const when = `${parseDateKey(t.due).month + 1}/${parseDateKey(t.due).day}${t.dueTime ? ' ' + t.dueTime : ''}`;
    const before = Number(t.alarm) ? `（${(ALARM_CHOICES.find(([v]) => v === Number(t.alarm)) || [0, ''])[1]}）` : '';
    out.push({ id: t.id, at, title: `🔔 ${t.title}`, body: `期限 ${when}${before}${t.goalId && goalName[t.goalId] ? '・🧭 ' + goalName[t.goalId] : ''}` });
  });
  return out.sort((a, b) => a.at - b.at).slice(0, 100);
}

// ブラウザで開いている間のアラーム（Android アプリはアプリが鳴らす）。鳴らしたものは覚えておき、2回鳴らさない
function loadFired() { try { return JSON.parse(window.localStorage.getItem(ALARM_FIRED_KEY) || '{}') || {}; } catch (e) { return {}; } }
function markFired(key) {
  const f = loadFired(); f[key] = Date.now();
  // 古い記録は消す（30日）
  Object.keys(f).forEach((k) => { if (Date.now() - f[k] > 30 * 86400000) delete f[k]; });
  try { window.localStorage.setItem(ALARM_FIRED_KEY, JSON.stringify(f)); } catch (e) {}
}
