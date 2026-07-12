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

// マスター予定(ev)を [rangeStartKey, rangeEndKey] の範囲内で実際の発生日に展開する
function expandEventOccurrences(ev, rangeStartKey, rangeEndKey) {
  const rec = ev.recurrence;
  const excluded = new Set(ev.excludedDates || []);
  const result = [];

  if (!rec || rec.freq === 'none') {
    if (ev.date >= rangeStartKey && ev.date <= rangeEndKey && !excluded.has(ev.date)) {
      result.push({ ...ev, occurrenceDate: ev.date, masterId: ev.id, isRecurring: false });
    }
    return result;
  }

  const hasUntil = rec.endType === 'until' && rec.endDate;
  const hasCount = rec.endType === 'count' && rec.endCount;
  const SAFETY_CAP_DAYS = 7300; // 約20年分。無限ループ防止のガード

  let curKey = ev.date < rangeStartKey ? ev.date : ev.date; // 開始日から走査(範囲より前から数える必要があるため)
  let matchIndex = 0;
  let iterGuard = 0;

  while (curKey <= rangeEndKey && iterGuard < SAFETY_CAP_DAYS) {
    if (hasUntil && curKey > rec.endDate) break;
    if (matchesRecurrencePattern(ev.date, rec, curKey)) {
      if (hasCount && matchIndex >= rec.endCount) break;
      if (curKey >= rangeStartKey && !excluded.has(curKey)) {
        result.push({ ...ev, date: curKey, occurrenceDate: curKey, masterId: ev.id, isRecurring: true });
      }
      matchIndex += 1;
    }
    curKey = addDaysToKey(curKey, 1);
    iterGuard += 1;
  }

  return result;
}
