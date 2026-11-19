// --- すするanki の「見るだけ」の予定：URL で購読したカレンダー・グループの予定 ---
// 依存: date-utils.js (addDaysToKey, todayKey, parseDateKey), recurrence.js (expandEventOccurrences)
// ・URL で購読したカレンダー：すするanki が読んだ .ics を gzip して Firestore の susuru_anki_ical/{uid}_{sid}（本人だけ読める）に置いている。
//   それを sync.js が読み、ここで予定にする（すするanki の calParseIcs・calMergeRepeats と同じ読み方）
// ・グループの予定：susuru_anki_groups/{id} の events（メンバーなら読める）
// ・どちらも、すするanki の予定の形 { title, date, end, start, endTime, repeat: weekly|biweekly, days, until, skip, rec, place, note, type }。
//   航海日誌では直せない（元のカレンダー・すするanki で直す）。その日の発生（occurrence）にして、カレンダーに足す

const ANKI_FEED_TYPES = ['class', 'test', 'exam', 'deadline', 'event'];
const ANKI_BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function ankiDate(ds) { const p = parseDateKey(ds); return new Date(p.year, p.month, p.day); }
function ankiDow(ds) { return ankiDate(ds).getDay(); }
function ankiMonday(ds) { const x = ankiDate(ds); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
function ankiHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function ankiIcsUnesc(s) { return String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); }
function ankiIcsParseDT(v) {
  const m = String(v).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return null;
  if (!m[4]) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '' };
  if (m[7]) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    return { date: dateKey(d.getFullYear(), d.getMonth(), d.getDate()), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}
function ankiGuessType(title, multi, repeat, timed) {
  if (/試験期間|定期考査|考査|期末|中間試験/.test(title) && multi) return 'exam';
  if (/出願|締切|締め切り|〆切|期限|入試|受験|共通テスト|合格発表|申込/.test(title)) return 'deadline';
  if (/テスト|試験|小テ|test|quiz|exam|模試|検定/i.test(title)) return multi ? 'exam' : 'test';
  if (repeat && timed) return 'class';
  return multi ? 'exam' : 'event';
}

// その日にある予定か（すするanki の calOccursOn と同じ。rec（航海日誌の形の繰り返し）は recurrence.js で数える）
function ankiOccursOn(ev, ds) {
  if ((ev.skip || []).includes(ds)) return false;
  if (ev.end && ev.end > ev.date) return ds >= ev.date && ds <= ev.end;
  if (ev.repeat === 'weekly' || ev.repeat === 'biweekly') {
    if (ds < ev.date || (ev.until && ds > ev.until)) return false;
    const days = ev.days && ev.days.length ? ev.days.map(Number) : [ankiDow(ev.date)];
    if (!days.includes(ankiDow(ds))) return false;
    if (ev.repeat === 'biweekly') {
      const w = Math.round((ankiMonday(ds) - ankiMonday(ev.date)) / (7 * 86400000));
      if (w % 2) return false;
    }
    return true;
  }
  return ev.date === ds;
}

// .ics を読む（1か月以上前に終わった予定は除く）
function ankiParseIcs(text) {
  const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out = [];
  let cur = null;
  lines.forEach((line) => {
    if (line === 'BEGIN:VEVENT') { cur = { exd: [] }; return; }
    if (line === 'END:VEVENT') { if (cur) out.push(cur); cur = null; return; }
    if (!cur) return;
    const i = line.indexOf(':'); if (i < 0) return;
    const head = line.slice(0, i), val = line.slice(i + 1), name = head.split(';')[0].toUpperCase();
    if (name === 'EXDATE') val.split(',').forEach((x) => cur.exd.push(x)); else cur[name] = val;
  });
  const old = addDaysToKey(todayKey(), -30), res = [];
  out.forEach((v) => {
    if (!v.DTSTART || (v.STATUS || '').toUpperCase() === 'CANCELLED' || v['RECURRENCE-ID']) return;
    const s = ankiIcsParseDT(v.DTSTART); if (!s) return;
    const en = v.DTEND ? ankiIcsParseDT(v.DTEND) : null;
    const title = ankiIcsUnesc(v.SUMMARY || '（名前なし）').trim();
    const e = { title, date: s.date };
    if (s.time) { e.start = s.time; if (en && en.time && en.date === s.date) e.endTime = en.time; }
    else if (en && en.date && addDaysToKey(en.date, -1) > s.date) e.end = addDaysToKey(en.date, -1);
    let last = e.end || e.date;
    if (v.RRULE) {
      const r = {};
      v.RRULE.split(';').forEach((kv) => { const [k, x] = kv.split('='); r[k.toUpperCase()] = x; });
      const iv = Number(r.INTERVAL) || 1;
      if (r.FREQ === 'WEEKLY' || (r.FREQ === 'DAILY' && iv === 1)) {
        e.repeat = r.FREQ === 'WEEKLY' && iv === 2 ? 'biweekly' : 'weekly';
        e.days = r.FREQ === 'DAILY' ? [0, 1, 2, 3, 4, 5, 6]
          : r.BYDAY ? r.BYDAY.split(',').map((x) => ANKI_BYDAY.indexOf(x.replace(/[^A-Z]/g, ''))).filter((x) => x >= 0) : [ankiDow(s.date)];
        if (!e.days.length) e.days = [ankiDow(s.date)];
        if (r.UNTIL) { const u = ankiIcsParseDT(r.UNTIL); if (u) e.until = u.date; }
        else if (r.COUNT) e.until = addDaysToKey(s.date, Math.ceil(Number(r.COUNT) / e.days.length) * 7 * (e.repeat === 'biweekly' ? 2 : 1));
        last = e.until || '9999-12-31';
        delete e.end;
      } else if (r.FREQ === 'MONTHLY' || r.FREQ === 'YEARLY' || r.FREQ === 'DAILY') {
        // 毎月・毎年・何日おき：航海日誌の繰り返しの形で持つ
        e.rec = {
          freq: r.FREQ.toLowerCase(), interval: iv, daysOfWeek: [],
          endType: r.UNTIL ? 'until' : r.COUNT ? 'count' : 'never',
          endDate: r.UNTIL ? (ankiIcsParseDT(r.UNTIL) || {}).date || null : null,
          endCount: r.COUNT ? Number(r.COUNT) : null,
        };
        last = e.rec.endDate || '9999-12-31';
      }
    }
    if (v.exd.length) e.skip = v.exd.map((x) => (ankiIcsParseDT(x) || {}).date).filter(Boolean);
    if (v.LOCATION) e.place = ankiIcsUnesc(v.LOCATION).trim();
    if (v.DESCRIPTION) e.note = ankiIcsUnesc(v.DESCRIPTION).trim().slice(0, 1000);
    const t = (v['X-SUSURU-TYPE'] || '').trim();
    e.type = ANKI_FEED_TYPES.includes(t) ? t : ankiGuessType(title, !!e.end, !!(e.repeat || e.rec), !!e.start);
    if (e.type === 'exam' && e.repeat === 'weekly' && (e.days || []).length === 7 && e.until && e.until < '9999') {
      e.end = e.until; delete e.repeat; delete e.days; delete e.until;
    }
    if (last < old) return;
    res.push({ id: 'ics' + ankiHash(v.UID || (title + s.date + (s.time || ''))), ev: e });
  });
  return ankiMergeRepeats(res);
}

// 同じ名前・同じ時刻の1日だけの予定が3回以上あれば、1つの繰り返しの予定にまとめる（すするanki の calMergeRepeats と同じ）
function ankiMergeRepeats(res) {
  const groups = {};
  res.forEach((x) => {
    const e = x.ev; if (e.repeat || e.end || e.rec) return;
    const k = [e.title, e.start || '', e.endTime || ''].join('\u0001');
    (groups[k] = groups[k] || []).push(x);
  });
  const drop = new Set(), add = [];
  Object.values(groups).forEach((xs) => {
    const dates = [...new Set(xs.map((x) => x.ev.date))].sort();
    if (dates.length < 3) return;
    const first = dates[0], last = dates[dates.length - 1], m0 = ankiMonday(first);
    const wk = (ds) => Math.round((ankiMonday(ds) - m0) / (7 * 86400000));
    const days = [...new Set(dates.map(ankiDow))].sort();
    const ev = { ...xs.find((x) => x.ev.date === first).ev, date: first, until: last, repeat: dates.every((d) => wk(d) % 2 === 0) ? 'biweekly' : 'weekly', days };
    const have = new Set(dates), skip = [];
    for (let ds = first; ds <= last; ds = addDaysToKey(ds, 1)) if (!have.has(ds) && ankiOccursOn({ ...ev, skip: [] }, ds)) skip.push(ds);
    if (skip.length) ev.skip = skip; else delete ev.skip;
    if (ev.type === 'event') ev.type = ankiGuessType(ev.title, false, true, !!ev.start);
    xs.forEach((x) => drop.add(x));
    add.push({ id: 'icsr' + ankiHash(ev.title + '|' + (ev.start || '') + '|' + (ev.endTime || '')), ev });
  });
  return res.filter((x) => !drop.has(x)).concat(add);
}

// 見るだけの予定（[{ id, ev, source: { kind: 'sub'|'group', name } }]）を、[start, end] の発生にする（VoyageLog の予定の発生と同じ形）
function ankiFeedOccurrences(list, startKey, endKey) {
  const out = [];
  (list || []).forEach(({ id, ev, source }) => {
    if (!ev || !ev.date || ev.deleted) return;
    const base = {
      id, masterId: id, title: ev.title || '（名前なし）', date: ev.date,
      allDay: !ev.start, startTime: ev.start || '', endTime: ev.endTime || ev.start || '',
      location: ev.place || '', notes: ev.note || '', type: ev.type || 'event',
      readOnly: true, source, isRecurring: !!(ev.repeat || ev.rec),
      instanceDate: ev.date, spanEnd: !ev.repeat && !ev.rec && ev.end && ev.end > ev.date ? ev.end : ev.date,
      recurrence: ev.rec || (ev.repeat ? { freq: 'weekly', interval: ev.repeat === 'biweekly' ? 2 : 1 } : null),
    };
    if (ev.rec && ev.rec.freq && ev.rec.freq !== 'none') {
      expandEventOccurrences({ ...base, recurrence: ev.rec, excludedDates: ev.skip || [] }, startKey, endKey)
        .forEach((o) => out.push({ ...o, ...base, date: o.occurrenceDate, occurrenceDate: o.occurrenceDate }));
      return;
    }
    // 繰り返さない・何日か続く予定は、その日だけを見る。毎週・隔週は範囲の日を順に見る
    const last = ev.repeat ? (ev.until || endKey) : (ev.end && ev.end > ev.date ? ev.end : ev.date);
    const from = ev.date > startKey ? ev.date : startKey;
    const to = last < endKey ? last : endKey;
    for (let k = from, g = 0; k <= to && g < 800; k = addDaysToKey(k, 1), g++) {
      if (ankiOccursOn(ev, k)) out.push({ ...base, occurrenceDate: k });
    }
  });
  return out;
}

// グループの予定（すするanki の形）を、見るだけの予定の一覧にする
function ankiGroupFeedList(groups) {
  const out = [];
  (groups || []).forEach((g) => {
    Object.entries(g.events || {}).forEach(([id, e]) => {
      if (e && !e.deleted && e.date) out.push({ id: `g_${g.id}_${id}`, ev: e, source: { kind: 'group', name: g.name || 'グループ' } });
    });
  });
  return out;
}
