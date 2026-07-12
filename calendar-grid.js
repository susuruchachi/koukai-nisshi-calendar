// --- 月表示グリッドの生成 ---
// 依存: date-utils.js (dateKey, parseDateKey), constants.js (WEEKDAYS_JA)

function getMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = startWeekday - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    let y = year, m = month - 1;
    if (m < 0) { m = 11; y -= 1; }
    cells.push({ day, currentMonth: false, key: dateKey(y, m, day) });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, currentMonth: true, key: dateKey(year, month, d) });
  }
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    let y = year, m = month + 1;
    if (m > 11) { m = 0; y += 1; }
    cells.push({ day: nextDay, currentMonth: false, key: dateKey(y, m, nextDay) });
    nextDay += 1;
  }
  return cells;
}

function formatSelectedHeading(key) {
  const { year, month, day } = parseDateKey(key);
  const dt = new Date(year, month, day);
  const wd = WEEKDAYS_JA[dt.getDay()];
  return `${month + 1}月${day}日 (${wd})`;
}
