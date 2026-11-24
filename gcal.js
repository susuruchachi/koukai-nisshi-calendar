// --- 📆 Googleカレンダーと同期 ---
// ・航海日誌 → Google：Googleカレンダーの中に、このアプリが作った「航海日誌」カレンダーに、航海日誌の予定を書く（直す・消すも）。
//   メインのカレンダーには書かない（おかしくなっても「航海日誌」カレンダーを消せば元どおり）。Google 側で直しても航海日誌には戻らない
// ・Google → 航海日誌：選んだカレンダー（メイン・家族と共有しているカレンダーなど）の予定を、見るだけの予定としてカレンダー・ウィジェットに出す
// ・許可（スコープ）はせまく：calendar.app.created（このアプリが作ったカレンダーだけ書ける）・calendar.calendarlist.readonly（カレンダーの一覧）・
//   calendar.events.readonly（予定を読む）
// ・アクセストークン（1時間）：Android アプリはアプリが Google に頼む（KoukaiApp.gcalAuthorize。一度許可すれば、あとは画面なしで何度でも）。
//   ブラウザは Google Identity Services（はじめは許可の画面。1時間たったら「つなぎ直す」を押す）。トークンはこの端末の中だけ（sessionStorage）
//   スマホのブラウザは、ポップアップ（別のタブ）から結果が戻らず白い画面で止まることがあるので、ページごと Google に移って戻ってくる（redirect）。
//   戻り先（このページの URL）は、Google Cloud の Web client の「承認済みのリダイレクト URI」に入れておく
// ・iOS のアプリ（すするアプリ）：KoukaiApp.gcalAuthorize はアプリが iOS のログインの画面で Google に頼む（すするanki の ios/）。
//   Google からは、ブラウザと同じ戻り先（このページ）の #access_token=…&state=ios-… に戻ってきて、index.html のいちばん上の部分がアプリに渡す
// ・同期するのは、アプリ・ページを開いている間（開いたとき・予定を変えたとき・10分ごと・「今すぐ同期」）
// 依存（呼ばれるときに）: ics-export.js の buildRRule、date-utils.js の addDaysToKey・dateKey・pad、anki-feeds.js の ankiGuessType
(function () {
  const CLIENT_ID = '926791749187-pq139a7m09tnp8pupfineqp8ibruhu9v.apps.googleusercontent.com';
  const SCOPES = [
    'https://www.googleapis.com/auth/calendar.app.created',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events.readonly',
  ];
  const API = 'https://www.googleapis.com/calendar/v3';
  const CAL_NAME = '航海日誌';
  const K = { on: 'koukai-nisshi-gcal-on', sel: 'koukai-nisshi-gcal-sel', cal: 'koukai-nisshi-gcal-calid', pushed: 'koukai-nisshi-gcal-pushed',
    cache: 'koukai-nisshi-gcal-cache', token: 'koukai-nisshi-gcal-token' };
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'; } catch (e) { return 'Asia/Tokyo'; } })();

  let getEvents = () => [];
  let token = null; // { value, exp }
  try { const t = JSON.parse(sessionStorage.getItem(K.token) || 'null'); if (t && t.exp > Date.now() + 60000) token = t; } catch (e) {}
  const cache = ls.get(K.cache, {}) || {};
  const st = {
    on: !!ls.get(K.on, false), needsAuth: false, busy: false, error: '', lastSync: cache.at || 0,
    calendars: cache.calendars || [], selected: ls.get(K.sel, null), feedItems: [], pushed: 0, calId: ls.get(K.cal, ''),
  };
  let feed = cache.feed || [];
  const listeners = new Set();
  function emit() {
    st.feedItems = st.on ? feed : [];
    st.pushed = Object.keys(ls.get(K.pushed, {}) || {}).length;
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
      description: `${ev.notes ? ev.notes + '\n\n' : ''}— 航海日誌から（ここで直しても航海日誌には戻りません。直すときは航海日誌で）`,
      location: ev.location || '',
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
      if (multi && !rec) recurrence.push(`RRULE:FREQ=DAILY;UNTIL=${ev.end.replace(/-/g, '')}T235959Z`);
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
      (j.items || []).forEach((c) => items.push({ id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#7FB69E', primary: !!c.primary, owner: c.accessRole === 'owner' }));
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

  async function push(calId) {
    const pushed = ls.get(K.pushed, {}) || {};
    const events = (getEvents() || []).filter((e) => e && e.id && e.date);
    const want = {};
    events.forEach((e) => { want[gid(e.id)] = toGoogle(e); });
    const ups = Object.entries(want).filter(([g, body]) => pushed[g] !== JSON.stringify(body));
    let dels = Object.keys(pushed).filter((g) => !want[g]);
    // 予定がまとめて消えたように見えるとき（アカウントを替えた直後など）は、Google から消さない
    if (dels.length > 3 && dels.length >= Object.keys(pushed).length) dels = [];
    const cal = encodeURIComponent(calId);
    const errs = await pool(ups, 4, async ([g, body]) => {
      try { await api(`/calendars/${cal}/events/${g}`, { method: 'PUT', body: { ...body, id: g } }); }
      catch (e) {
        if (e.status !== 404) throw e;
        try { await api(`/calendars/${cal}/events`, { method: 'POST', body: { ...body, id: g } }); }
        catch (e2) { if (e2.status !== 409) throw e2; await api(`/calendars/${cal}/events/${g}`, { method: 'PUT', body: { ...body, id: g } }); }
      }
      pushed[g] = JSON.stringify(body); ls.set(K.pushed, pushed);
    });
    errs.push(...await pool(dels, 4, async (g) => {
      try { await api(`/calendars/${cal}/events/${g}`, { method: 'DELETE' }); }
      catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
      delete pushed[g]; ls.set(K.pushed, pushed);
    }));
    if (errs.length) throw errs[0];
  }

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
        await push(calId);
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

  let pushTimer = null;
  window.KoukaiGcal = {
    subscribe(fn) { listeners.add(fn); fn({ ...st, feedItems: st.on ? feed : [] }); return () => listeners.delete(fn); },
    state: () => ({ ...st }),
    // VoyageLog から：今の予定を読む関数（変わったら changed を呼んでもらう）
    attach(fn) { getEvents = fn; if (st.on) setTimeout(() => sync(false), 1500); },
    changed() { if (!st.on) return; clearTimeout(pushTimer); pushTimer = setTimeout(() => sync(false), 4000); },
    // つなぐ（ボタンから：許可の画面を出す）・切る
    connect() { st.on = true; ls.set(K.on, true); emit(); return sync(true); },
    disconnect() { st.on = false; st.needsAuth = false; st.error = ''; ls.set(K.on, false); dropToken(); emit(); },
    syncNow() { return sync(true); },
    setSelected(ids) { st.selected = ids; ls.set(K.sel, ids); emit(); return sync(false); },
    _toGoogle: toGoogle, _fromGoogle: fromGoogle, _gid: gid,
  };

  // 開いている間は10分ごと。アプリに戻ったときも（前の同期から5分たっていれば）
  setInterval(() => { if (st.on && document.visibilityState === 'visible') sync(false); }, 10 * 60000);
  document.addEventListener('visibilitychange', () => {
    if (st.on && document.visibilityState === 'visible' && Date.now() - st.lastSync > 5 * 60000) sync(false);
  });
  emit();
})();
