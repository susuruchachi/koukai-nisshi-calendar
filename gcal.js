// --- 📆 Googleカレンダーと同期 ---
// ・航海日誌 ⇄ Google の「航海日誌」カレンダー（このアプリが作ったカレンダー）：航海日誌の予定を書き（直す・消すも）、
//   Google でその「航海日誌」カレンダーの予定を直す・足す・消すと、航海日誌にも届く（両方で変えたときは、あとで変えた方）。メインのカレンダーには書かない
// ・Google → 航海日誌：選んだカレンダー（メイン・家族と共有しているカレンダーなど）の予定を、カレンダー・ウィジェットに出す。
//   書きこめるカレンダー（自分のもの・編集できる共有）の予定は、航海日誌から直す・消すこともできる（繰り返しの予定は、その回だけ）
// ・許可（スコープ）：calendar.app.created（このアプリが作ったカレンダー）・calendar.calendarlist.readonly（カレンダーの一覧）・
//   calendar.events（予定を読む・直す。前は calendar.events.readonly だったので、許可をもらい直す）
// ・アクセストークン（1時間）：Android アプリはアプリが Google に頼む（KoukaiApp.gcalAuthorize。一度許可すれば、あとは画面なしで何度でも）。
//   ブラウザは Google Identity Services（はじめは許可の画面。1時間たったら「つなぎ直す」を押す）。トークンはこの端末の中だけ（sessionStorage）
//   スマホのブラウザは、ポップアップ（別のタブ）から結果が戻らず白い画面で止まることがあるので、ページごと Google に移って戻ってくる（redirect）。
//   戻り先（このページの URL）は、Google Cloud の Web client の「承認済みのリダイレクト URI」に入れておく
// ・iOS のアプリ（すするアプリ）：KoukaiApp.gcalAuthorize はアプリが iOS のログインの画面で Google に頼む（すするanki の ios/）。
//   Google からは、ブラウザと同じ戻り先（このページ）の #access_token=…&state=ios-… に戻ってきて、index.html のいちばん上の部分がアプリに渡す
// ・同期するのは、アプリ・ページを開いている間（開いたとき・予定を変えたとき・5分ごと・アプリに戻ったとき・「今すぐ同期」）
// 依存（呼ばれるときに）: ics-export.js の buildRRule、date-utils.js の addDaysToKey・dateKey・pad、anki-feeds.js の ankiGuessType
(function () {
  const CLIENT_ID = '926791749187-pq139a7m09tnp8pupfineqp8ibruhu9v.apps.googleusercontent.com';
  const SCOPES = [
    'https://www.googleapis.com/auth/calendar.app.created',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ];
  const API = 'https://www.googleapis.com/calendar/v3';
  const CAL_NAME = '航海日誌';
  const K = { on: 'koukai-nisshi-gcal-on', sel: 'koukai-nisshi-gcal-sel', cal: 'koukai-nisshi-gcal-calid', pushed: 'koukai-nisshi-gcal-sent',
    cache: 'koukai-nisshi-gcal-cache', token: 'koukai-nisshi-gcal-token' };
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'; } catch (e) { return 'Asia/Tokyo'; } })();

  let getEvents = () => [];
  let applyEvents = null; // VoyageLog の persist（Google で変わった予定を航海日誌に入れる）
  let token = null; // { value, exp }
  try { const t = JSON.parse(sessionStorage.getItem(K.token) || 'null'); if (t && t.exp > Date.now() + 60000) token = t; } catch (e) {}
  const cache = ls.get(K.cache, {}) || {};
  const st = {
    on: !!ls.get(K.on, false), needsAuth: false, busy: false, error: '', lastSync: cache.at || 0,
    calendars: cache.calendars || [], selected: ls.get(K.sel, null), feedItems: [], pushed: 0, calId: ls.get(K.cal, ''),
    failed: [], // Google に送れなかった予定 [{ title, message }]
    fromGoogle: 0, // 前の同期で Google から航海日誌に入れた数
  };
  let feed = cache.feed || [];
  const listeners = new Set();
  function emit() {
    st.feedItems = st.on ? feed : [];
    st.pushed = Object.keys((ls.get(K.pushed, {}) || {}).items || {}).length;
    const s = { ...st };
    listeners.forEach((fn) => { try { fn(s); } catch (e) {} });
  }
  const isApp = () => !!(window.KoukaiApp && window.KoukaiApp.gcalAuthorize);

  // ---------- トークン ----------
  function keepToken(value, seconds) {
    token = { value, exp: Date.now() + Math.max(60, (seconds || 3600) - 120) * 1000 };
    try { sessionStorage.setItem(K.token, JSON.stringify(token)); } catch (e) {}
  }
  function dropToken() { token = null; try { sessionStorage.removeItem(K.token); } catch (e) {} }

  let nativeWait = null;
  window.__koukaiGcalToken = (value, err, needsUi) => {
    const w = nativeWait; nativeWait = null;
    if (!w) return;
    if (value) { keepToken(value, 3600); w.resolve(value); } else w.reject(Object.assign(new Error(err || 'Google に断られました'), { needsUi: !!needsUi }));
  };
  function nativeToken(interactive) {
    return new Promise((resolve, reject) => {
      nativeWait = { resolve, reject };
      try { window.KoukaiApp.gcalAuthorize(SCOPES.join(' '), !!interactive); } catch (e) { nativeWait = null; reject(e); }
      setTimeout(() => { if (nativeWait) { nativeWait = null; reject(new Error('時間切れ')); } }, 120000);
    });
  }

  let gisLoading = null, tokenClient = null;
  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (gisLoading) return gisLoading;
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => resolve(); s.onerror = () => { gisLoading = null; reject(new Error('Google の部品を読み込めませんでした')); };
      document.head.appendChild(s);
    });
    return gisLoading;
  }
  async function webToken() {
    await loadGis();
    return new Promise((resolve, reject) => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID, scope: SCOPES.join(' '), prompt: '',
        callback: (r) => {
          if (r && r.access_token) {
            if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...SCOPES)) { reject(new Error('Googleカレンダーの許可が足りません（すべてにチェックを入れてください）')); return; }
            keepToken(r.access_token, Number(r.expires_in) || 3600); resolve(r.access_token);
          } else reject(new Error((r && (r.error_description || r.error)) || 'Google に断られました'));
        },
        error_callback: (e) => reject(new Error((e && (e.message || e.type)) || 'Google の画面を開けませんでした')),
      });
      tokenClient.requestAccessToken();
    });
  }

  // ---- スマホのブラウザ：ページごと Google に移って、許可をもらって戻ってくる ----
  const isMobileBrowser = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') && !isApp();
  function returnUrl() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
  function redirectForToken() {
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    try { sessionStorage.setItem('koukai-nisshi-gcal-state', state); } catch (e) {}
    const q = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: returnUrl(), response_type: 'token', scope: SCOPES.join(' '), include_granted_scopes: 'true', state });
    // ログインしている航海日誌のアカウントを先に選んでおく（同じ Google アカウントなら、アカウントを選ぶ画面をとばせる）
    try { const u = window.VoyageSync && window.VoyageSync.state().user; if (u && u.email) q.set('login_hint', u.email); } catch (e) {}
    location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + q.toString());
    return new Promise(() => {}); // ページが移るので、ここでは終わらない
  }
  // 戻ってきたとき：URL の #access_token=… を受け取る（合言葉 state が同じときだけ）。受け取ったら URL から消す
  (function takeRedirect() {
    if (!/access_token=|error=/.test(location.hash || '')) return;
    const h = new URLSearchParams(location.hash.slice(1));
    let want = '';
    try { want = sessionStorage.getItem('koukai-nisshi-gcal-state') || ''; sessionStorage.removeItem('koukai-nisshi-gcal-state'); } catch (e) {}
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    if (!want || h.get('state') !== want) return;
    if (h.get('access_token')) {
      const granted = (h.get('scope') || '').split(' ');
      if (SCOPES.every((sc) => granted.includes(sc))) { keepToken(h.get('access_token'), Number(h.get('expires_in')) || 3600); st.on = true; ls.set(K.on, true); }
      else st.error = 'Googleカレンダーの許可が足りません（すべてにチェックを入れてください）';
    } else st.error = h.get('error') === 'access_denied' ? 'Googleカレンダーの許可がもらえませんでした' : 'Google に断られました（' + h.get('error') + '）';
  })();

  // interactive：ボタンを押したとき（許可の画面を出してよい）。そうでなければ、画面を出さずに取れるときだけ
  async function getToken(interactive) {
    if (token && token.exp > Date.now()) return token.value;
    if (isApp()) return nativeToken(interactive);
    if (!interactive) throw Object.assign(new Error('つなぎ直してください'), { needsUi: true });
    return isMobileBrowser() ? redirectForToken() : webToken();
  }

  // ---------- Google Calendar API ----------
  async function api(path, opts = {}) {
    const t = await getToken(false);
    const r = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: { Authorization: 'Bearer ' + t, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (r.status === 401) { dropToken(); throw Object.assign(new Error('Google のログインが切れました'), { needsUi: true }); }
    if (r.status === 403) {
      const j0 = await r.clone().json().catch(() => null);
      const reason = j0 && j0.error && ((j0.error.errors || [])[0] || {}).reason;
      // 前の許可（calendar.events.readonly）のままのとき：許可をもらい直す
      if (reason === 'insufficientPermissions' || /insufficient/i.test((j0 && j0.error && j0.error.message) || '')) { dropToken(); throw Object.assign(new Error('許可をもらい直してください'), { needsUi: true }); }
    }
    if (r.status === 204) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error((j && j.error && j.error.message) || ('HTTP ' + r.status)), { status: r.status });
    return j;
  }

  // 航海日誌の予定 id → Google の予定 id（Google は a〜v と 0〜9 しか使えないので、16進数にする）
  function gid(id) {
    let h = 'kn';
    for (const b of new TextEncoder().encode(String(id))) h += b.toString(16).padStart(2, '0');
    return h.slice(0, 1000);
  }
  function plusHour(t) { const [h, m] = t.split(':').map(Number); return `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

  // 航海日誌の予定 → Google の予定
  function toGoogle(ev) {
    const multi = ev.end && ev.end > ev.date;
    const rec = ev.recurrence && ev.recurrence.freq && ev.recurrence.freq !== 'none';
    const icons = typeof TYPE_ICONS !== 'undefined' ? TYPE_ICONS : {};
    const out = {
      summary: `${ev.star ? '★ ' : ''}${icons[ev.type] ? icons[ev.type] + ' ' : ''}${ev.title || '（名前なし）'}`,
      description: `${ev.notes ? ev.notes + '\n\n' : ''}${FOOTER}`,
      location: ev.location || '',
      status: 'confirmed', // 前に Google で消した予定でも、航海日誌にあれば元に戻す
      extendedProperties: { private: { koukaiId: String(ev.id) } },
    };
    const recurrence = [];
    const st0 = ev.startTime || '09:00';
    if (ev.allDay) {
      out.start = { date: ev.date };
      out.end = { date: addDaysToKey(multi ? ev.end : ev.date, 1) };
    } else {
      let et = ev.endTime || st0;
      // 何日か続く予定：繰り返すなら続けて1つ、繰り返さないなら「その期間の毎日その時刻」（すするanki と同じ）
      const endDate = multi && rec ? ev.end : ev.date;
      if (endDate === ev.date && et <= st0) et = plusHour(st0);
      out.start = { dateTime: `${ev.date}T${st0}:00`, timeZone: tz };
      out.end = { dateTime: `${endDate}T${et}:00`, timeZone: tz };
      if (multi && !rec) { recurrence.push(`RRULE:FREQ=DAILY;UNTIL=${ev.end.replace(/-/g, '')}T235959Z`); out.extendedProperties.private.koukaiSpan = '1'; }
    }
    if (rec && typeof buildRRule === 'function') {
      let r = buildRRule(ev.recurrence);
      if (r && !ev.allDay) r = r.replace(/UNTIL=(\d{8})(?![T\d])/, 'UNTIL=$1T235959Z');
      if (r) recurrence.push('RRULE:' + r);
    }
    const ex = (ev.excludedDates || []).filter(Boolean);
    if (ex.length && recurrence.length) {
      recurrence.push(ev.allDay ? `EXDATE;VALUE=DATE:${ex.map((d) => d.replace(/-/g, '')).join(',')}`
        : `EXDATE;TZID=${tz}:${ex.map((d) => d.replace(/-/g, '') + 'T' + st0.replace(':', '') + '00').join(',')}`);
    }
    if (recurrence.length) out.recurrence = recurrence;
    return out;
  }

  const FOOTER = '— 航海日誌の予定（Google で直しても、航海日誌に届きます）';
  // 航海日誌の予定 → Google に送る中身（くらべるための文字列）
  const bodyKey = (ev) => JSON.stringify(toGoogle(ev));
  const gidOf = (ev) => ev.gcalId || gid(ev.id);

  // ---------- Google の「航海日誌」カレンダーの予定 → 航海日誌の予定（Google で直されたとき）----------
  const ymd = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  function parseRecurrence(lines) {
    let rec = null; const ex = [];
    (lines || []).forEach((line) => {
      const i = line.indexOf(':'); if (i < 0) return;
      const head = line.slice(0, i).toUpperCase(), val = line.slice(i + 1);
      if (head === 'RRULE') {
        const r = {}; val.split(';').forEach((kv) => { const [k, v] = kv.split('='); r[(k || '').toUpperCase()] = v; });
        const freq = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }[r.FREQ];
        if (!freq) return;
        const days = r.BYDAY ? r.BYDAY.split(',').map((x) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(x.replace(/[^A-Z]/g, ''))).filter((x) => x >= 0) : [];
        rec = { freq, interval: Math.max(1, Number(r.INTERVAL) || 1), daysOfWeek: freq === 'weekly' ? days.sort() : [],
          endType: r.UNTIL ? 'until' : r.COUNT ? 'count' : 'never', endDate: r.UNTIL ? ymd(r.UNTIL) : null, endCount: r.COUNT ? Number(r.COUNT) : null };
      } else if (head.startsWith('EXDATE')) {
        val.split(',').forEach((v) => { if (/^\d{8}/.test(v)) ex.push(ymd(v)); });
      }
    });
    return { rec, ex };
  }
  // base：今の航海日誌の予定（あれば）。航海日誌だけにある項目（種類・予算など）は base のまま
  function fromGoogleOwn(item, base, cancelledDates) {
    const icons = typeof TYPE_ICONS !== 'undefined' ? TYPE_ICONS : {};
    let title = item.summary || '（名前なし）', star = false;
    if (title.startsWith('★ ')) { star = true; title = title.slice(2); }
    const type = base && base.type;
    if (type && icons[type] && title.startsWith(icons[type] + ' ')) title = title.slice(icons[type].length + 1);
    let notes = String(item.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
    const fi = notes.lastIndexOf('— 航海日誌');
    if (fi >= 0) notes = notes.slice(0, fi);
    notes = notes.replace(/\s+$/, '');
    const ev = { ...(base || {}), title, notes, location: item.location || '', star };
    delete ev.end;
    const { rec, ex } = parseRecurrence(item.recurrence);
    const span = item.extendedProperties && item.extendedProperties.private && item.extendedProperties.private.koukaiSpan === '1';
    if (item.start.date) {
      ev.allDay = true; ev.date = item.start.date;
      const last = item.end && item.end.date ? addDaysToKey(item.end.date, -1) : ev.date;
      if (last > ev.date) ev.end = last;
      ev.startTime = (base && base.startTime) || '09:00'; ev.endTime = (base && base.endTime) || '10:00';
    } else {
      const a = localParts(item.start.dateTime), b = item.end && item.end.dateTime ? localParts(item.end.dateTime) : a;
      ev.allDay = false; ev.date = a.date; ev.startTime = a.time; ev.endTime = b.time;
      if (b.date > a.date) ev.end = b.date;
    }
    // 時刻のある、何日か続く予定（繰り返さない）は、Google では「毎日」にして送っている（koukaiSpan）。それなら元の形に戻す
    if (span && rec && rec.freq === 'daily' && rec.interval === 1 && rec.endDate && !ev.allDay) { ev.end = rec.endDate > ev.date ? rec.endDate : ''; ev.recurrence = null; }
    else ev.recurrence = rec;
    if (!ev.end) delete ev.end;
    ev.excludedDates = [...new Set([...ex, ...(cancelledDates || [])])].sort();
    return ev;
  }

  // Google の予定 → 見るだけの予定（すするanki の形。anki-feeds.js の ankiFeedOccurrences で出す）
  function localParts(dt) {
    const d = new Date(dt);
    return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
  }
  function fromGoogle(item, cal) {
    if (!item || item.status === 'cancelled' || !item.start) return null;
    const title = item.summary || '（名前なし）';
    const ev = { title };
    if (item.start.date) {
      ev.date = item.start.date;
      const last = item.end && item.end.date ? addDaysToKey(item.end.date, -1) : ev.date;
      if (last > ev.date) ev.end = last;
    } else if (item.start.dateTime) {
      const s = localParts(item.start.dateTime), e = item.end && item.end.dateTime ? localParts(item.end.dateTime) : s;
      ev.date = s.date; ev.start = s.time;
      if (e.date === s.date) { if (e.time > s.time) ev.endTime = e.time; } else ev.end = e.date;
    } else return null;
    if (item.location) ev.place = item.location;
    if (item.description) ev.note = String(item.description).replace(/<[^>]+>/g, ' ').slice(0, 500);
    // 種類は名前から（何日か続くだけで「試験期間」にはしない。家族旅行などがあるため）
    ev.type = typeof ankiGuessType === 'function' ? ankiGuessType(title, false, !!item.recurringEventId, !!ev.start) : 'event';
    if (ev.end && /試験期間|考査/.test(title)) ev.type = 'exam';
    // 書きこめるカレンダーなら、航海日誌から直せる（繰り返しの予定は、その回だけ）
    ev.gcal = { calId: cal.id, eventId: item.id, recurring: !!item.recurringEventId, editable: !!cal.canEdit, calName: cal.name };
    return { id: `gc_${cal.id}_${item.id}`, ev, source: { kind: 'gcal', name: cal.name, color: cal.color } };
  }

  // ---------- 同期 ----------
  async function ensureCalendar() {
    if (st.calId) {
      try { await api(`/calendars/${encodeURIComponent(st.calId)}`); return st.calId; } catch (e) { if (e.needsUi) throw e; st.calId = ''; }
    }
    // ほかの端末が作った「航海日誌」カレンダーがあれば、それを使う（2つ作らない）
    const own = st.calendars.find((c) => c.name === CAL_NAME && c.owner);
    let id = own && own.id;
    if (!id) {
      const made = await api('/calendars', { method: 'POST', body: { summary: CAL_NAME, description: '航海日誌（koukai-nisshi-calendar）の予定。航海日誌が自動で書きます', timeZone: tz } });
      id = made.id;
    }
    st.calId = id; ls.set(K.cal, id);
    return id;
  }

  async function loadCalendars() {
    const items = [];
    let page = '';
    for (let g = 0; g < 5; g++) {
      const j = await api(`/users/me/calendarList?maxResults=250${page ? '&pageToken=' + encodeURIComponent(page) : ''}`);
      (j.items || []).forEach((c) => items.push({ id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#7FB69E', primary: !!c.primary, owner: c.accessRole === 'owner', canEdit: c.accessRole === 'owner' || c.accessRole === 'writer' }));
      if (!j.nextPageToken) break; page = j.nextPageToken;
    }
    st.calendars = items;
    if (!st.selected) { st.selected = items.filter((c) => c.primary).map((c) => c.id); ls.set(K.sel, st.selected); }
  }

  // 1つずつ（4つまで同時に）
  async function pool(list, n, fn) {
    let i = 0; const errs = [];
    await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
      while (i < list.length) { const x = list[i++]; try { await fn(x); } catch (e) { if (e.needsUi) throw e; errs.push(e); } }
    }));
    return errs;
  }

  // 送った記録：{ calId, items: { Googleの予定id: { h: 送った中身, etag: Google の版, id: 航海日誌の予定id } } }
  // 「航海日誌」カレンダーが変わったら（消して作り直したなど）、記録を消して全部送り直す
  function sentFor(calId) {
    const m = ls.get(K.pushed, null);
    return m && m.calId === calId && m.items ? m : { calId, items: {} };
  }
  const saveSent = (m) => ls.set(K.pushed, m);
  function deletedIds() { try { return JSON.parse(localStorage.getItem('koukai-nisshi-deleted') || '{}') || {}; } catch (e) { return {}; } }

  // ① Google の「航海日誌」カレンダーで直された・足された・消された予定を、航海日誌に入れる
  async function pullOwn(calId, sent) {
    const items = [];
    let page = '';
    for (let g = 0; g < 8; g++) {
      const j = await api(`/calendars/${encodeURIComponent(calId)}/events?showDeleted=true&maxResults=2500${page ? '&pageToken=' + encodeURIComponent(page) : ''}`);
      items.push(...(j.items || []));
      if (!j.nextPageToken) break; page = j.nextPageToken;
    }
    // 繰り返しの予定の「この回だけ消した」（Google では消えた回）→ 除外日
    const cancelledOf = {};
    items.forEach((it) => {
      if (it.recurringEventId && it.status === 'cancelled' && it.originalStartTime) {
        const o = it.originalStartTime.date || localParts(it.originalStartTime.dateTime).date;
        (cancelledOf[it.recurringEventId] = cancelledOf[it.recurringEventId] || []).push(o);
      }
    });
    const events = (getEvents() || []).filter((e) => e && e.id && e.date);
    const byG = {}; events.forEach((e) => { byG[gidOf(e)] = e; });
    const dels = deletedIds();
    let next = null; const edit = () => (next = next || events.slice());
    let n = 0;
    for (const it of items) {
      if (it.recurringEventId) continue; // 1回だけ直した回は、元の繰り返しのまま（消した回は上の除外日）
      const rec = sent.items[it.id];
      const local = byG[it.id];
      const kid = it.extendedProperties && it.extendedProperties.private && it.extendedProperties.private.koukaiId;
      const gUpdated = Date.parse(it.updated || '') || 0;
      if (it.status === 'cancelled') {
        // Google で消された：航海日誌の方が新しく直していなければ、航海日誌からも消す
        if (local && rec && gUpdated > (local.at || 0)) {
          const k = edit().findIndex((e) => e.id === local.id); if (k >= 0) next.splice(k, 1);
          delete sent.items[it.id]; n++;
        }
        continue;
      }
      if (local) {
        // まだ送った記録が無い（はじめて・この版にしたすぐあと）→ 航海日誌の方を正として、②で送る
        if (!rec || rec.etag === it.etag) continue;
        const conv = fromGoogleOwn(it, local, cancelledOf[it.id]);
        if (bodyKey(conv) === bodyKey(local)) { sent.items[it.id] = { h: bodyKey(local), etag: it.etag, id: local.id }; continue; }
        const localChanged = rec.h !== bodyKey(local);
        if (!localChanged || gUpdated > (local.at || 0)) {
          const k = edit().findIndex((e) => e.id === local.id); if (k >= 0) next[k] = { ...conv, id: local.id };
          sent.items[it.id] = { h: bodyKey(next[k]), etag: it.etag, id: local.id }; n++;
        }
        continue;
      }
      // 航海日誌に無い予定
      if (kid && dels[kid]) {
        // 航海日誌で消した予定（ほかの端末で消して、Google にまだ残っている）→ Google からも消す
        try { await api(`/calendars/${encodeURIComponent(calId)}/events/${it.id}`, { method: 'DELETE' }); } catch (e) { if (e.needsUi) throw e; }
        delete sent.items[it.id];
        continue;
      }
      if (kid) continue; // ほかの端末が送った予定（航海日誌の同期でまだ届いていない）→ 届くのを待つ
      if (rec) continue; // 送ったことがある → 航海日誌で消された（下の送る段で Google からも消す）
      // Google の「航海日誌」カレンダーで足された予定 → 航海日誌の予定にする（Google の予定の id を gcalId に覚える）
      const id = typeof generateId === 'function' ? generateId() : 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const ev = { ...fromGoogleOwn(it, null, cancelledOf[it.id]), id, gcalId: it.id, type: 'event' };
      edit().push(ev);
      sent.items[it.id] = { h: '', etag: it.etag, id }; // 航海日誌の id を Google にも書くため、次の段で送る
      n++;
    }
    saveSent(sent);
    if (next && applyEvents) await applyEvents(next);
    st.fromGoogle = n;
  }

  // ② 航海日誌の予定を Google の「航海日誌」カレンダーに送る（中身が変わったものだけ）。航海日誌で消したものは Google からも消す
  async function push(calId, sent) {
    const events = (getEvents() || []).filter((e) => e && e.id && e.date);
    const want = {};
    events.forEach((e) => { want[gidOf(e)] = e; });
    const ups = Object.entries(want).filter(([g, ev]) => !sent.items[g] || sent.items[g].h !== bodyKey(ev));
    let dels = Object.keys(sent.items).filter((g) => !want[g]);
    // 予定がまとめて消えたように見えるとき（アカウントを替えた直後など）は、Google から消さない
    if (dels.length > 3 && dels.length >= Object.keys(sent.items).length) dels = [];
    const cal = encodeURIComponent(calId);
    const failed = [];
    await pool(ups, 4, async ([g, ev]) => {
      const body = { ...toGoogle(ev), id: g };
      try {
        let r;
        const put = () => api(`/calendars/${cal}/events/${g}`, { method: 'PUT', body });
        const post = () => api(`/calendars/${cal}/events`, { method: 'POST', body });
        if (sent.items[g]) {
          // 送ったことがある → 直す（無ければ作る）
          try { r = await put(); } catch (e) { if (e.status !== 404) throw e; r = await post(); }
        } else {
          // はじめて → 作る（もうあれば直す：ほかの端末が送った・前に送った記録が消えた）
          try { r = await post(); } catch (e) { if (e.status !== 409) throw e; r = await put(); }
        }
        sent.items[g] = { h: bodyKey(ev), etag: r && r.etag, id: ev.id }; saveSent(sent);
      } catch (e) {
        if (e.needsUi) throw e;
        failed.push({ title: ev.title || '（名前なし）', date: ev.date, message: e.message || String(e) });
      }
    });
    await pool(dels, 4, async (g) => {
      try { await api(`/calendars/${cal}/events/${g}`, { method: 'DELETE' }); }
      catch (e) { if (e.needsUi) throw e; if (e.status !== 404 && e.status !== 410) { failed.push({ title: '（消した予定）', message: e.message }); return; } }
      delete sent.items[g]; saveSent(sent);
    });
    st.failed = failed;
  }

  // ③ 選んだカレンダーの予定を読む（書きこめるカレンダーの予定は、航海日誌から直せる）
  async function pull() {
    const now = new Date();
    const timeMin = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString();
    const timeMax = new Date(now.getFullYear() + 1, now.getMonth() + 2, 1).toISOString();
    const next = [];
    for (const id of st.selected || []) {
      const cal = st.calendars.find((c) => c.id === id);
      if (!cal || id === st.calId) continue;
      let page = '';
      for (let g = 0; g < 4; g++) {
        const q = `singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}${page ? '&pageToken=' + encodeURIComponent(page) : ''}`;
        const j = await api(`/calendars/${encodeURIComponent(id)}/events?${q}`);
        (j.items || []).forEach((it) => { const f = fromGoogle(it, cal); if (f) next.push(f); });
        if (!j.nextPageToken) break; page = j.nextPageToken;
      }
    }
    feed = next;
  }

  let running = null, again = false;
  async function sync(interactive) {
    if (!st.on) return;
    if (running) { again = true; return running; }
    running = (async () => {
      st.busy = true; st.error = ''; emit();
      try {
        if (interactive) await getToken(true);
        await loadCalendars();
        const calId = await ensureCalendar();
        const sent = sentFor(calId);
        await pullOwn(calId, sent);
        await push(calId, sent);
        await pull();
        st.needsAuth = false; st.lastSync = Date.now();
        ls.set(K.cache, { at: st.lastSync, calendars: st.calendars, feed });
      } catch (e) {
        if (e.needsUi) { st.needsAuth = true; st.error = ''; } else st.error = e.message || String(e);
      } finally {
        st.busy = false; running = null; emit();
        if (again) { again = false; setTimeout(() => sync(false), 500); }
      }
    })();
    return running;
  }

  // ---------- 航海日誌から、Google のほかのカレンダーの予定を直す・消す ----------
  // f：{ calId, eventId, title, date, end, allDay, startTime, endTime, location, notes }（繰り返しの予定は、その回の eventId なので、その回だけ）
  async function saveGoogleEvent(f) {
    await getToken(true);
    const multi = f.end && f.end > f.date;
    const body = { summary: f.title || '（名前なし）', location: f.location || '', description: f.notes || '' };
    if (f.allDay) { body.start = { date: f.date }; body.end = { date: addDaysToKey(multi ? f.end : f.date, 1) }; }
    else {
      const st0 = f.startTime || '09:00'; let et = f.endTime || st0; const endDate = multi ? f.end : f.date;
      if (endDate === f.date && et <= st0) et = plusHour(st0);
      body.start = { dateTime: `${f.date}T${st0}:00`, timeZone: tz }; body.end = { dateTime: `${endDate}T${et}:00`, timeZone: tz };
    }
    await api(`/calendars/${encodeURIComponent(f.calId)}/events/${encodeURIComponent(f.eventId)}`, { method: 'PATCH', body });
    await pull(); ls.set(K.cache, { at: st.lastSync, calendars: st.calendars, feed }); emit();
  }
  async function deleteGoogleEvent(f) {
    await getToken(true);
    try { await api(`/calendars/${encodeURIComponent(f.calId)}/events/${encodeURIComponent(f.eventId)}`, { method: 'DELETE' }); }
    catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
    feed = feed.filter((x) => !(x.ev && x.ev.gcal && x.ev.gcal.eventId === f.eventId && x.ev.gcal.calId === f.calId));
    ls.set(K.cache, { at: st.lastSync, calendars: st.calendars, feed }); emit();
  }

  let pushTimer = null;
  window.KoukaiGcal = {
    subscribe(fn) { listeners.add(fn); fn({ ...st, feedItems: st.on ? feed : [] }); return () => listeners.delete(fn); },
    state: () => ({ ...st }),
    // VoyageLog から：今の予定を読む関数と、Google で変わった予定を入れる関数（persist）
    attach(fn, applyFn) { getEvents = fn; if (applyFn) applyEvents = applyFn; if (st.on) setTimeout(() => sync(false), 1500); },
    changed() { if (!st.on) return; clearTimeout(pushTimer); pushTimer = setTimeout(() => sync(false), 4000); },
    // つなぐ（ボタンから：許可の画面を出す）・切る
    connect() { st.on = true; ls.set(K.on, true); emit(); return sync(true); },
    disconnect() { st.on = false; st.needsAuth = false; st.error = ''; ls.set(K.on, false); dropToken(); emit(); },
    syncNow() { return sync(true); },
    setSelected(ids) { st.selected = ids; ls.set(K.sel, ids); emit(); return sync(false); },
    saveGoogleEvent, deleteGoogleEvent,
    _toGoogle: toGoogle, _fromGoogle: fromGoogle, _fromGoogleOwn: fromGoogleOwn, _gid: gid,
  };

  // 開いている間は5分ごと（Google で直した分が届くように）。アプリに戻ったときも（前の同期から2分たっていれば）
  setInterval(() => { if (st.on && document.visibilityState === 'visible') sync(false); }, 5 * 60000);
  document.addEventListener('visibilitychange', () => {
    if (st.on && document.visibilityState === 'visible' && Date.now() - st.lastSync > 2 * 60000) sync(false);
  });
  emit();
})();
