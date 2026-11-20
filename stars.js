// --- ★ 大事な予定（あと何日）---
// 依存: date-utils.js (todayKey, addDaysToKey, parseDateKey), recurrence.js (expandEventOccurrences, eventSpanDays), anki-feeds.js (ankiFeedOccurrences)
// ・予定の star: true が「★ 重要な予定」。すするanki とも同期する（sync.js の SHARED・すするanki の calToShared/calFromShared）
// ・その予定のこれからの回（繰り返しなら、いちばん近い回。何日か続く予定の途中なら「期間中」）を、近い順に並べる
// ・ウィジェットには、1つの予定につき3回ぶんまで渡す（日付が変わって1回目が終わっても、ウィジェットが次の回を出せるように）

const STAR_HORIZON_DAYS = 400; // 1年ちょっと先まで見る（毎年の予定も次の回が見つかるように）

// [{ id, n: 名前, i: 印, d: その回のはじめの日, e2: 最後の日（1日だけなら ''）, s: 開始時刻（終日なら ''）, ro: 見るだけの予定か }]
function starInstances(events, feeds, today, perEvent) {
  const t = today || todayKey();
  const from = addDaysToKey(t, -400), to = addDaysToKey(t, STAR_HORIZON_DAYS);
  const icons = typeof TYPE_ICONS !== 'undefined' ? TYPE_ICONS : {};
  const out = [], count = {}, seen = new Set();
  const take = (o, ro) => {
    const d = o.instanceDate || o.occurrenceDate;
    const last = o.spanEnd && o.spanEnd > d ? o.spanEnd : d;
    if (last < t) return;
    const key = o.masterId + '|' + d;
    if (seen.has(key)) return;
    if ((count[o.masterId] || 0) >= perEvent) return;
    seen.add(key); count[o.masterId] = (count[o.masterId] || 0) + 1;
    out.push({ id: o.masterId, n: o.title || '', i: icons[o.type] || '', d, e2: last > d ? last : '', s: o.allDay ? '' : (o.startTime || ''), ro: !!ro });
  };
  (events || []).filter((e) => e && e.star).forEach((ev) => {
    // 何日か続く予定の途中も拾えるように、日数ぶん前から見る
    const span = typeof eventSpanDays === 'function' ? eventSpanDays(ev) : 0;
    let occ = [];
    try { occ = expandEventOccurrences(ev, addDaysToKey(t, -span), to); } catch (e) { occ = []; }
    occ.sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate)).forEach((o) => take(o, false));
  });
  const starFeeds = (feeds || []).filter((f) => f && f.ev && f.ev.star);
  if (starFeeds.length && typeof ankiFeedOccurrences === 'function') {
    ankiFeedOccurrences(starFeeds, from, to).sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate)).forEach((o) => take(o, true));
  }
  return out.sort((a, b) => a.d.localeCompare(b.d) || (a.s || '').localeCompare(b.s || ''));
}

// 画面の一覧：1つの予定につき、いちばん近い回だけ
function starUpcoming(events, feeds, today) {
  return starInstances(events, feeds, today, 1);
}

// 「あと何日」の言い方（ウィジェットの StarWidget.java と同じ）
function starLeftText(item, today) {
  const t = today || todayKey();
  const days = (a, b) => { const x = parseDateKey(a), y = parseDateKey(b); return Math.round((new Date(y.year, y.month, y.day) - new Date(x.year, x.month, x.day)) / 86400000); };
  if (item.d <= t && item.e2 && item.e2 >= t) return item.d === t ? '今日から' : '期間中';
  const n = days(t, item.d);
  return n <= 0 ? '今日' : n === 1 ? '明日' : `あと${n}日`;
}
