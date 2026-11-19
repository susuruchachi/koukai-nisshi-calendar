// --- Android アプリ（android/ の WebView 版）とのやりとり ---
// 依存: date-utils.js, recurrence.js, diary.js, anki-feeds.js
// ・アプリの中で開いているときだけ window.KoukaiApp がある（MainActivity.java の Bridge）
// ・ホーム画面のウィジェット（カレンダー・できた事日記）に、予定と日記を渡す（KoukaiApp.setWidgetData）
// ・ウィジェットから開いたとき（「できた事を書く」など）は window.__koukaiOpen(view) が呼ばれる

// 公開している APK の versionCode（android/app/build.gradle と同じ数。GitHub Actions の android-apk が作り直したときに上げる）
const ANDROID_APK_CODE = 3;
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
        n: o.title || '',
        i: (typeof TYPE_ICONS !== 'undefined' && TYPE_ICONS[o.type]) || '',
      });
    });
  });
  // すするanki の見るだけの予定（URL で購読・グループ）も出す
  try {
    ankiFeedOccurrences(feeds || [], start, end).forEach((o) => {
      (days[o.occurrenceDate] = days[o.occurrenceDate] || []).push({
        s: o.allDay ? '' : (o.startTime || ''), e: o.allDay ? '' : (o.endTime || ''), n: o.title || '',
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
  return { today, days, diary: d, at: Date.now() };
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
