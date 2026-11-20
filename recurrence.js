// --- 繰り返し予定のロジック ---
// 依存: date-utils.js (parseDateKey, addDaysToKey)

// 指定した日付が、この繰り返しルールの発生日にあたるかどうかを判定する
function matchesRecurrencePattern(startKey, rec, dayKey) {
  const interval = Math.max(1, parseInt(rec.interval, 10) || 1);
  const start = parseDateKey(startKey);
  const cur = parseDateKey(dayKey);
  const startDate = new Date(start.year, start.month, start.day);
  const curDate = new Date(cur.year, cur.month, cur.day);
  if (curDate < startDate) return false;

  if (rec.freq === 'daily') {
    const diff = Math.round((curDate - startDate) / 86400000);
    return diff % interval === 0;
  }

  if (rec.freq === 'weekly') {
    const days = rec.daysOfWeek && rec.daysOfWeek.length > 0 ? rec.daysOfWeek : [startDate.getDay()];
    if (!days.includes(curDate.getDay())) return false;
    const startWeekSunday = new Date(startDate);
    startWeekSunday.setDate(startWeekSunday.getDate() - startWeekSunday.getDay());
    const curWeekSunday = new Date(curDate);
    curWeekSunday.setDate(curWeekSunday.getDate() - curWeekSunday.getDay());
    const weekDiff = Math.round((curWeekSunday - startWeekSunday) / (7 * 86400000));
    return weekDiff % interval === 0;
  }

  if (rec.freq === 'monthly') {
    if (curDate.getDate() !== startDate.getDate()) return false;
    const monthDiff = (curDate.getFullYear() - startDate.getFullYear()) * 12 + (curDate.getMonth() - startDate.getMonth());
    return monthDiff >= 0 && monthDiff % interval === 0;
  }

  if (rec.freq === 'yearly') {
    if (curDate.getDate() !== startDate.getDate() || curDate.getMonth() !== startDate.getMonth()) return false;
    const yearDiff = curDate.getFullYear() - startDate.getFullYear();
    return yearDiff >= 0 && yearDiff % interval === 0;
  }

  return false;
}

// 何日か続く予定の日数（end が最後の日。1日だけなら 0）
function eventSpanDays(ev) {
  if (!ev.end || ev.end <= ev.date) return 0;
  const a = parseDateKey(ev.date), b = parseDateKey(ev.end);
  return Math.round((new Date(b.year, b.month, b.day) - new Date(a.year, a.month, a.day)) / 86400000);
}

// マスター予定(ev)を [rangeStartKey, rangeEndKey] の範囲内で実際の発生日に展開する
// ・何日か続く予定（end が最後の日）は、その間の毎日に出す。どの発生にも instanceDate（その回の最初の日）と spanEnd（その回の最後の日）を付ける
// ・何日か続く予定を繰り返すとき（毎年の合宿など）は、繰り返しの日がその回の最初の日になり、そこから同じ日数だけ続く。
//   「この回のみ削除」（excludedDates）は、その回の最初の日で覚える
function expandEventOccurrences(ev, rangeStartKey, rangeEndKey) {
  const rec = ev.recurrence;
  const excluded = new Set(ev.excludedDates || []);
  const span = eventSpanDays(ev);
  const result = [];

  if (!rec || rec.freq === 'none') {
    // 繰り返さない予定（何日か続く予定はその間の毎日。すするanki の試験期間などは、1日ずつ消した日が excludedDates にある）
    const last = span ? ev.end : ev.date;
    for (let k = ev.date, g = 0; k <= last && g < 400; k = addDaysToKey(k, 1), g++) {
      if (k >= rangeStartKey && k <= rangeEndKey && !excluded.has(k)) {
        result.push({ ...ev, occurrenceDate: k, masterId: ev.id, isRecurring: false, instanceDate: ev.date, spanEnd: last });
      }
    }
    return result;
  }

  const hasUntil = rec.endType === 'until' && rec.endDate;
  const hasCount = rec.endType === 'count' && rec.endCount;
  const SAFETY_CAP_DAYS = 7300; // 約20年分。無限ループ防止のガード

  // 開始日から走査（回数を数えるため）。回数の指定が無ければ、繰り返しの判定は開始日を基準にしているので、
  // 範囲（何日か続く予定はその日数ぶん前）から見ればよい（昔からの毎年の予定＝誕生日なども、20年の上限に引っかからない）
  let curKey = ev.date;
  if (!hasCount) {
    const from = span ? addDaysToKey(rangeStartKey, -span) : rangeStartKey;
    if (from > curKey) curKey = from;
  }
  let matchIndex = 0;
  let iterGuard = 0;

  while (curKey <= rangeEndKey && iterGuard < SAFETY_CAP_DAYS) {
    if (hasUntil && curKey > rec.endDate) break;
    if (matchesRecurrencePattern(ev.date, rec, curKey)) {
      if (hasCount && matchIndex >= rec.endCount) break;
      if (!excluded.has(curKey)) {
        const spanEnd = span ? addDaysToKey(curKey, span) : curKey;
        if (spanEnd >= rangeStartKey) {
          for (let k = curKey, d = 0; d <= span; k = addDaysToKey(k, 1), d++) {
            if (k >= rangeStartKey && k <= rangeEndKey) {
              result.push({ ...ev, date: curKey, occurrenceDate: k, masterId: ev.id, isRecurring: true, instanceDate: curKey, spanEnd });
            }
          }
        }
      }
      matchIndex += 1;
    }
    curKey = addDaysToKey(curKey, 1);
    iterGuard += 1;
  }

  return result;
}
