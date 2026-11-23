// --- Android アプリ（android/ の WebView 版）とのやりとり ---
// 依存: date-utils.js, recurrence.js, diary.js, anki-feeds.js, stars.js
// ・アプリの中で開いているときだけ window.KoukaiApp がある（MainActivity.java の Bridge）
// ・ホーム画面のウィジェット（カレンダー・できた事日記）に、予定と日記を渡す（KoukaiApp.setWidgetData）
// ・ウィジェットから開いたとき（「できた事を書く」など）は window.__koukaiOpen(view) が呼ばれる

// 公開している APK の versionCode（android/app/build.gradle と同じ数。GitHub Actions の android-apk が作り直したときに上げる）
const ANDROID_APK_CODE = 7;
// ブラウザ・古いアプリでダウンロードするとき（GitHub）と、アプリが自動で更新するとき（このサイト：アプリはこのサイトの APK しか取らない）
const ANDROID_APK_URL = 'https://github.com/susuruchachi/koukai-nisshi-calendar/raw/main/apk/koukai-nisshi.apk';
const ANDROID_APK_SELF_URL = new URL('apk/koukai-nisshi.apk', window.location.href.split(/[?#]/)[0].replace(/[^/]*$/, '')).toString();

function koukaiIsApp() {
  return !!(window.KoukaiApp && window.KoukaiApp.setWidgetData);
}

// 入っているアプリが古いか（新しい APK があるか）
function koukaiAppOutdated() {
  try { return koukaiIsApp() && window.KoukaiApp.versionCode && window.KoukaiApp.versionCode() < ANDROID_APK_CODE; } catch (e) { return false; }
}

// ウィジェットに渡すもの：
//   days  … 先月の1日から62日先までの、日ごとの予定 [{ s: 開始, e: 終了, n: 名前, i: 印 }]（終日は s が空）
//   diary … 今日から90日前までの日記 { 日付: { items, anki } }（連続日数はウィジェットで数え直す）
function koukaiBuildWidgetData(events, diary, feeds) {
  const today = todayKey();
  const now = new Date();
  const start = dateKey(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(), (now.getMonth() + 11) % 12, 1);
  const end = addDaysToKey(today, 62);
  const days = {};
  (events || []).forEach((ev) => {
    let occ = [];
    try { occ = expandEventOccurrences(ev, start, end); } catch (e) { occ = []; }
    occ.forEach((o) => {
      const k = o.occurrenceDate;
      (days[k] = days[k] || []).push({
        s: o.allDay ? '' : (o.startTime || ''),
        e: o.allDay ? '' : (o.endTime || ''),
        n: (o.title || '') + koukaiSpanLabel(o),
        i: (typeof TYPE_ICONS !== 'undefined' && TYPE_ICONS[o.type]) || '',
      });
    });
  });
  // すするanki の見るだけの予定（URL で購読・グループ）も出す
  try {
    ankiFeedOccurrences(feeds || [], start, end).forEach((o) => {
      (days[o.occurrenceDate] = days[o.occurrenceDate] || []).push({
        s: o.allDay ? '' : (o.startTime || ''), e: o.allDay ? '' : (o.endTime || ''), n: (o.title || '') + koukaiSpanLabel(o),
        i: (typeof TYPE_ICONS !== 'undefined' && TYPE_ICONS[o.type]) || '',
      });
    });
  } catch (e) {}
  Object.values(days).forEach((list) => list.sort((a, b) => (a.s || '').localeCompare(b.s || '')));
  const from = addDaysToKey(today, -90);
  const d = {};
  Object.keys(diary || {}).forEach((k) => {
    if (k < from || k > end) return;
    const e = diary[k];
    if (diaryHasContent(e)) d[k] = { items: e.items, anki: e.anki };
  });
  // ★ 大事な予定（1つの予定につき3回ぶんまで。日付が変わったら、ウィジェットが次の回を出す）
  let stars = [];
  try { stars = starInstances(events, feeds, today, 3).slice(0, 60).map(({ n, i, d, e2, s, id }) => ({ k: id, n, i, d, e2, s })); } catch (e) {}
  return { today, days, diary: d, stars, at: Date.now() };
}

// 何日か続く予定は、ウィジェットで「（〜11/27）」と最後の日を出す
function koukaiSpanLabel(o) {
  if (!o.spanEnd || !o.instanceDate || o.spanEnd <= o.instanceDate) return '';
  const p = parseDateKey(o.spanEnd);
  return `（〜${p.month + 1}/${p.day}）`;
}

let _koukaiWidgetTimer = null;
function koukaiSendWidget(events, diary, feeds) {
  if (!koukaiIsApp()) return;
  clearTimeout(_koukaiWidgetTimer);
  _koukaiWidgetTimer = setTimeout(() => {
    try { window.KoukaiApp.setWidgetData(JSON.stringify(koukaiBuildWidgetData(events, diary, feeds))); } catch (e) {}
  }, 500);
}

// 文字のファイルを保存する（アプリの中では「ダウンロード」フォルダーに。ブラウザのダウンロードは WebView では動かないため）
function koukaiSaveTextFile(filename, mime, text) {
  if (!(window.KoukaiApp && window.KoukaiApp.saveFile)) return false;
  try {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return !!window.KoukaiApp.saveFile(filename, mime, btoa(bin));
  } catch (e) {
    return false;
  }
}

// 開いたときの URL の ?view=diary / ?view=day&date=YYYY-MM-DD（ウィジェットから）を読む
function koukaiStartView() {
  try {
    const q = new URLSearchParams(window.location.search);
    return { view: q.get('view') || '', date: q.get('date') || '' };
  } catch (e) {
    return { view: '', date: '' };
  }
}

// ---- アプリの自動更新（MainActivity の apkPrepare など。1.2.0 から）----
// ・アプリを開いたとき（と、4時間ぶりに戻ったとき）に、新しい APK があれば裏でダウンロードする
// ・確認なしで入れられる（このアプリ自身が前に更新した）なら、アプリを閉じて1分たったら自動で入れ替わる → 何も出さない
// ・はじめの1回（ブラウザ・ファイルから入れたアプリ）は確認が要るので、「📲 アプリを更新」のお知らせを出す（koukai-apk イベント）
let koukaiApk = { ready: false, silent: false, busy: false };
let _koukaiApkAsked = 0, _koukaiApkInstallAfter = false;
function koukaiApkAuto() { return !!(window.KoukaiApp && window.KoukaiApp.apkPrepare); }
function koukaiApkEmit() { try { window.dispatchEvent(new CustomEvent('koukai-apk', { detail: { ...koukaiApk } })); } catch (e) {} }
function koukaiCheckApkUpdate(force) {
  if (!koukaiApkAuto() || !koukaiAppOutdated() || koukaiApk.busy) return;
  if (!force && Date.now() - _koukaiApkAsked < 4 * 3600000) return;
  _koukaiApkAsked = Date.now();
  koukaiApk.busy = true;
  try { window.KoukaiApp.apkPrepare(ANDROID_APK_SELF_URL, ANDROID_APK_CODE); } catch (e) { koukaiApk.busy = false; }
}
window.__koukaiApkReady = function (ok, silent) {
  koukaiApk = { ready: !!ok, silent: !!silent, busy: false };
  if (ok && _koukaiApkInstallAfter) { _koukaiApkInstallAfter = false; window.KoukaiApp.apkInstallNow(); }
  koukaiApkEmit();
};
// 「更新する」：ダウンロード済みなら入れる（確認の画面が出る）。まだならダウンロードしてから
function koukaiInstallApk() {
  if (!koukaiApkAuto()) { window.open(ANDROID_APK_URL, '_blank'); return; }
  try {
    if (window.KoukaiApp.apkReady()) window.KoukaiApp.apkInstallNow();
    else { _koukaiApkInstallAfter = true; koukaiCheckApkUpdate(true); }
  } catch (e) {}
}
// 予定を書いている途中は、裏に回っても入れ替えない（VoyageLog から）
function koukaiApkSetIdle(idle) { try { if (window.KoukaiApp && window.KoukaiApp.apkSetIdle) window.KoukaiApp.apkSetIdle(!!idle); } catch (e) {} }
if (koukaiApkAuto()) {
  setTimeout(() => koukaiCheckApkUpdate(false), 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') koukaiCheckApkUpdate(false); });
}

// ---- 🔔 タスクのアラーム（planner.js の alarmList）----
// ・Android アプリ（1.6.0 から）：KoukaiApp.setAlarms に渡すと、アプリが AlarmManager で時刻どおりに鳴らす（閉じていても・再起動しても）。
//   通知の「✅ 完了にする」で完了にしたタスクは、アプリが覚えておき、開いたときに koukaiTakeDoneTasks で受け取る
// ・ブラウザ：開いている間だけ、30秒ごとに時刻を見て、通知（許可があれば）と画面の知らせ・音で知らせる
function koukaiNativeAlarms() { return !!(window.KoukaiApp && window.KoukaiApp.setAlarms); }
let _koukaiAlarms = [];
function koukaiSetAlarms(list) {
  _koukaiAlarms = list || [];
  if (koukaiNativeAlarms()) { try { window.KoukaiApp.setAlarms(JSON.stringify(_koukaiAlarms)); } catch (e) {} }
}
function koukaiTakeDoneTasks() {
  try { return JSON.parse((window.KoukaiApp && window.KoukaiApp.takeDoneTasks && window.KoukaiApp.takeDoneTasks()) || '[]') || []; } catch (e) { return []; }
}
// アラームを付けたときに、通知の許可を聞く（Android 13 以上のアプリ・ブラウザ）
function koukaiAskNotifPermission() {
  try {
    if (window.KoukaiApp && window.KoukaiApp.requestNotifPermission) { window.KoukaiApp.requestNotifPermission(); return; }
    if (!koukaiIsApp() && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  } catch (e) {}
}
function koukaiBeep() {
  try {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = new C();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.28);
      o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3);
    });
  } catch (e) {}
}
function koukaiWebAlarmTick() {
  if (koukaiNativeAlarms()) return; // アプリが鳴らす
  const now = Date.now(), fired = loadFired();
  _koukaiAlarms.forEach((a) => {
    const key = a.id + '@' + a.at;
    if (a.at > now || now - a.at > 10 * 60000 || fired[key]) return; // 10分より前に過ぎたものは鳴らさない
    markFired(key);
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification(a.title, { body: a.body, tag: key, icon: './icons/icon-192.png' }); } catch (e) {}
    koukaiBeep();
    if (typeof window.__koukaiAlarmToast === 'function') window.__koukaiAlarmToast(`${a.title}（${a.body}）`);
  });
}
setInterval(koukaiWebAlarmTick, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(koukaiWebAlarmTick, 500); });
