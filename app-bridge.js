// --- Android アプリ（android/ の WebView 版）とのやりとり ---
// 依存: date-utils.js, recurrence.js, diary.js
// ・アプリの中で開いているときだけ window.KoukaiApp がある（MainActivity.java の Bridge）
// ・ホーム画面のウィジェット（カレンダー・できた事日記）に、予定と日記を渡す（KoukaiApp.setWidgetData）
// ・ウィジェットから開いたとき（「できた事を書く」など）は window.__koukaiOpen(view) が呼ばれる

// 公開している APK（android/ を作り直したら、ここと android/app/build.gradle の versionCode を一緒に上げる）
const ANDROID_APK_CODE = 1;
const ANDROID_APK_URL = 'https://github.com/susuruchachi/koukai-nisshi-calendar/raw/main/apk/koukai-nisshi.apk';

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
function koukaiBuildWidgetData(events, diary) {
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
function koukaiSendWidget(events, diary) {
  if (!koukaiIsApp()) return;
  clearTimeout(_koukaiWidgetTimer);
  _koukaiWidgetTimer = setTimeout(() => {
    try { window.KoukaiApp.setWidgetData(JSON.stringify(koukaiBuildWidgetData(events, diary))); } catch (e) {}
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
