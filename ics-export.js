// --- .ics (iCalendar) 書き出しロジック ---
// 依存: constants.js (ICS_WEEKDAYS), date-utils.js (pad, parseDateKey, addDaysToKey)

function buildRRule(rec) {
  if (!rec || rec.freq === 'none') return null;
  const freqMap = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };
  let rule = `FREQ=${freqMap[rec.freq]}`;
  const interval = Math.max(1, parseInt(rec.interval, 10) || 1);
  if (interval > 1) rule += `;INTERVAL=${interval}`;
  if (rec.freq === 'weekly' && rec.daysOfWeek && rec.daysOfWeek.length > 0) {
    rule += `;BYDAY=${[...rec.daysOfWeek].sort().map((d) => ICS_WEEKDAYS[d]).join(',')}`;
  }
  if (rec.endType === 'until' && rec.endDate) {
    rule += `;UNTIL=${formatICSDateOnly(rec.endDate)}`;
  } else if (rec.endType === 'count' && rec.endCount) {
    rule += `;COUNT=${Math.max(1, parseInt(rec.endCount, 10) || 1)}`;
  }
  return rule;
}

function formatICSDateTime(dateStrYMD, timeStrHM) {
  const { year, month, day } = parseDateKey(dateStrYMD);
  const [hh, mm] = (timeStrHM || '00:00').split(':').map(Number);
  const dt = new Date(year, month, day, hh, mm, 0);
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}${pad(dt.getUTCSeconds())}Z`;
}

function formatICSDateOnly(dateStrYMD) {
  return dateStrYMD.replace(/-/g, '');
}

function escapeICSText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function eventToVEVENT(ev) {
  const uid = `${ev.id}@koukai-nisshi.local`;
  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  // 何日か続く予定（end が最後の日）：終日なら DTEND をその次の日に。
  // 時刻ありで繰り返さないときは「その期間の毎日その時刻」（すするanki と同じ）なので、毎日の繰り返しにして書き出す
  const multi = ev.end && ev.end > ev.date;
  const hasRec = ev.recurrence && ev.recurrence.freq !== 'none';
  let dtStartLine, dtEndLine, dailyRule = null;
  if (ev.allDay) {
    dtStartLine = `DTSTART;VALUE=DATE:${formatICSDateOnly(ev.date)}`;
    dtEndLine = `DTEND;VALUE=DATE:${formatICSDateOnly(addDaysToKey(multi ? ev.end : ev.date, 1))}`;
  } else {
    dtStartLine = `DTSTART:${formatICSDateTime(ev.date, ev.startTime || '00:00')}`;
    dtEndLine = `DTEND:${formatICSDateTime(multi && hasRec ? ev.end : ev.date, ev.endTime || ev.startTime || '00:00')}`;
    if (multi && !hasRec) dailyRule = `FREQ=DAILY;UNTIL=${formatICSDateTime(ev.end, ev.startTime || '00:00')}`;
  }

  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    dtStartLine,
    dtEndLine,
    `SUMMARY:${escapeICSText(ev.title)}`,
  ];
  if (ev.location) lines.push(`LOCATION:${escapeICSText(ev.location)}`);
  if (ev.notes) lines.push(`DESCRIPTION:${escapeICSText(ev.notes)}`);

  const rrule = buildRRule(ev.recurrence) || dailyRule;
  if (rrule) lines.push(`RRULE:${rrule}`);

  if (rrule && ev.excludedDates && ev.excludedDates.length > 0) {
    if (ev.allDay) {
      lines.push(`EXDATE;VALUE=DATE:${ev.excludedDates.map(formatICSDateOnly).join(',')}`);
    } else {
      lines.push(`EXDATE:${ev.excludedDates.map((d) => formatICSDateTime(d, ev.startTime || '00:00')).join(',')}`);
    }
  }

  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

function buildICS(eventList) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Koukai Nisshi//Personal Calendar//JA',
    'CALSCALE:GREGORIAN',
    ...eventList.map(eventToVEVENT),
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

function downloadICS(filename, content) {
  // Android アプリの中では、アプリが「ダウンロード」フォルダーに保存する（app-bridge.js）
  if (typeof koukaiSaveTextFile === 'function' && koukaiSaveTextFile(filename, 'text/calendar', content)) return;
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
