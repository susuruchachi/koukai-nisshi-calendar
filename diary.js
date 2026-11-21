// --- できた事日記（1日に3つ（「＋」で好きなだけ増やせる）、できた事を書く ＋ すするanki で解いた数）---
// 依存: date-utils.js (todayKey, addDaysToKey)
// ・この端末の中：localStorage の koukai-nisshi-diary = { 'YYYY-MM-DD': { items: [3つ], anki: 数 or null, ankiAuto, at: 変えた時刻 } }
//   items ははじめ3つ。「＋ もう1つ書く」で増やせる（DIARY_MAX まで）。増やした欄は × で消せる
//   ankiAuto：false＝自分で入れた数（すするanki の記録で上書きしない）。それ以外は、すするanki でその日に解いた数（answered）を自動で入れる
// ・同期がオンなら、すするanki と同じ Firestore の文書（susuru_anki_cal/{uid}）の diary に入れる（sync.js）

const DIARY_KEY = 'koukai-nisshi-diary';
const DIARY_SLOTS = 3; // はじめの欄の数（目標）
const DIARY_MAX = 30; // 増やせるのはここまで
const DIARY_PLACEHOLDERS = ['例：朝ちゃんと起きられた', '例：机の上を片づけた', '例：友だちに「ありがとう」と言えた'];

function emptyDiaryEntry() {
  return { items: Array(DIARY_SLOTS).fill(''), anki: null, at: 0 };
}

// 届いたもの・古い形のものを、いつもの形にそろえる
function normalizeDiaryEntry(e) {
  const base = emptyDiaryEntry();
  if (!e || typeof e !== 'object') return base;
  const items = Array.isArray(e.items) ? e.items : [];
  const slots = Math.min(DIARY_MAX, Math.max(DIARY_SLOTS, items.length));
  for (let i = 0; i < slots; i++) base.items[i] = typeof items[i] === 'string' ? items[i] : '';
  const n = parseInt(e.anki, 10);
  base.anki = Number.isFinite(n) && n >= 0 ? n : null;
  if (e.ankiAuto === true || e.ankiAuto === false) base.ankiAuto = e.ankiAuto;
  base.at = e.at || 0;
  return base;
}

function loadDiary() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DIARY_KEY) || '{}') || {};
    const out = {};
    Object.keys(raw).forEach((k) => { out[k] = normalizeDiaryEntry(raw[k]); });
    return out;
  } catch (e) {
    return {};
  }
}

function saveDiaryLocal(map) {
  try { window.localStorage.setItem(DIARY_KEY, JSON.stringify(map)); return true; } catch (e) { return false; }
}

// 書いたできた事の数（0〜3）
function diaryDoneCount(e) {
  return e ? e.items.filter((s) => s && s.trim()).length : 0;
}

// 何か書いてある日か（できた事1つ以上、または すするanki の数）
function diaryHasContent(e) {
  return !!e && (diaryDoneCount(e) > 0 || e.anki !== null);
}

// 続けて書いた日数：今日書いていれば今日から、まだなら昨日からさかのぼって数える
function diaryStreak(map, today) {
  let key = today || todayKey();
  if (diaryDoneCount(map[key]) === 0) key = addDaysToKey(key, -1);
  let n = 0;
  while (diaryDoneCount(map[key]) > 0 && n < 3650) { n += 1; key = addDaysToKey(key, -1); }
  return n;
}

// その月（'YYYY-MM'）の合計：書いた日数・できた事の数・すするanki で解いた数
function diaryMonthTotals(map, ym) {
  let days = 0, done = 0, anki = 0;
  Object.keys(map).forEach((k) => {
    if (!k.startsWith(ym)) return;
    const e = map[k];
    if (!diaryHasContent(e)) return;
    days += 1;
    done += diaryDoneCount(e);
    anki += e.anki || 0;
  });
  return { days, done, anki };
}
