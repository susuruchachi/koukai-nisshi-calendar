// --- 貸し借り帳（susuru-obenri-tools/kashikari）と連携 ---
// 貸し借り帳の Firebase は別のプロジェクト（susuruchoubo）。ログインはせず、貸し借り帳でつくった「連携コード」（文書の ID）で読み書きする
//   kashikari_links/{連携コード} = { feed: 貸し借り帳から（定期の収入・支払い、後払い、返す期限、🎟 予定）, warn: 足りなくなりそうなら,
//                                   koukai: 航海日誌から（予算・入るお金のついた予定）, koukaiAt }
//   航海日誌が書けるのは koukai と koukaiAt だけ（貸し借り帳の Firestore のルールで決めている）
// ・feed は、すするanki の見るだけの予定と同じ形（{ id, ev, source }）にして、カレンダー・ウィジェットに出す（見るだけ）
// ・連携コードは、この端末（localStorage）と、ログインしていればアカウント（sync.js：susuru_anki_cal/{uid} の kashikari）に覚える
//   → 航海日誌のほかの端末にも届く。?kashikari=コード で開いても連携する（貸し借り帳の「航海日誌で開くリンク」）
// 依存（呼ばれるときに）: recurrence.js の expandEventOccurrences, date-utils.js の todayKey・addDaysToKey
(function () {
  const CONFIG = {
    apiKey: 'AIzaSyC0dWJ8Lc5uV3ZuHq1fmr0vDWpe1eesLYA', authDomain: 'susuruchoubo.firebaseapp.com',
    projectId: 'susuruchoubo', storageBucket: 'susuruchoubo.firebasestorage.app',
    messagingSenderId: '381718266364', appId: '1:381718266364:web:9c3f7208aa5c6a0ae67279',
  };
  const KEY = 'koukai-nisshi-kashikari', CACHE = 'koukai-nisshi-kashikari-feed';
  const okCode = (c) => /^[A-Za-z0-9]{20,40}$/.test(c || '');
  let db = null, unsub = null, pushTimer = null, pushedKey = '';
  const listeners = new Set();
  const st = { code: '', feed: [], feedItems: [], warn: null, feedAt: 0, koukaiAt: 0, error: '', ready: false };
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || 'null');
    if (c && c.code) { st.feed = c.feed || []; st.warn = c.warn || null; st.feedAt = c.feedAt || 0; }
    st.code = localStorage.getItem(KEY) || '';
    if (c && c.code !== st.code) { st.feed = []; st.warn = null; }
  } catch (e) {}

  function emit() {
    st.feedItems = st.feed.filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date || '')).map((x) => ({
      id: 'k_' + x.id,
      ev: { title: x.title || '（名前なし）', date: x.date, end: x.end || '', note: x.note || '', type: 'event' },
      source: { kind: 'kashikari', name: '貸し借り帳' },
    }));
    const s = { ...st };
    listeners.forEach((fn) => { try { fn(s); } catch (e) {} });
  }
  function dbOf() {
    if (db) return db;
    if (!window.firebase || !firebase.initializeApp) return null;
    const app = (firebase.apps || []).find((a) => a.name === 'kashikari') || firebase.initializeApp(CONFIG, 'kashikari');
    db = app.firestore();
    return db;
  }
  function watch() {
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    st.ready = false; st.error = '';
    if (!st.code) { st.feed = []; st.warn = null; emit(); return; }
    const d = dbOf();
    if (!d) { st.error = 'Firebase を読み込めませんでした'; emit(); return; }
    const code = st.code;
    unsub = d.collection('kashikari_links').doc(code).onSnapshot((snap) => {
      if (code !== st.code) return;
      if (!snap.exists) { st.error = 'その連携コードは見つかりません（貸し借り帳で連携をやめたかも）'; st.feed = []; st.warn = null; st.ready = true; emit(); return; }
      const x = snap.data();
      st.feed = Array.isArray(x.feed) ? x.feed : [];
      st.warn = x.warn || null; st.feedAt = x.feedAt || 0; st.koukaiAt = x.koukaiAt || 0; st.ready = true; st.error = '';
      try { localStorage.setItem(CACHE, JSON.stringify({ code, feed: st.feed, warn: st.warn, feedAt: st.feedAt })); } catch (e) {}
      emit();
      pushedKey = ''; // 文書が変わったら、こちらの予定も送り直せるように
      if (lastEvents) pushKoukai(lastEvents);
    }, (e) => { st.error = '読めませんでした（' + (e.code || e.message) + '）'; st.ready = true; emit(); });
  }
  // 連携コードを入れる（fromAccount：アカウントから届いたとき。アカウントには書き戻さない）
  function setCode(code, fromAccount) {
    code = String(code || '').trim();
    const m = code.match(/[?&]kashikari=([A-Za-z0-9]{20,40})/);
    if (m) code = m[1];
    if (code && !okCode(code)) return false;
    if (code === st.code) return true;
    st.code = code;
    try { if (code) localStorage.setItem(KEY, code); else { localStorage.removeItem(KEY); localStorage.removeItem(CACHE); } } catch (e) {}
    if (!fromAccount && window.VoyageSync && window.VoyageSync.setKashikari) window.VoyageSync.setKashikari(code);
    pushedKey = '';
    watch();
    return true;
  }

  // 航海日誌の予定のうち、予算（かかりそうなお金）・入るお金のついたもの（今日〜180日先。繰り返しは回ごと）を、貸し借り帳に送る
  let lastEvents = null;
  function pushKoukai(events) {
    lastEvents = events;
    if (!st.code || !st.ready || st.error) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      const from = todayKey(), to = addDaysToKey(from, 180), out = [];
      (events || []).forEach((ev) => {
        const budget = +ev.budget || 0, income = +ev.income || 0;
        if (!budget && !income) return;
        let occ = [];
        try { occ = expandEventOccurrences(ev, addDaysToKey(from, -30), to); } catch (e) { occ = []; }
        const seen = new Set();
        occ.forEach((o) => {
          const start = o.instanceDate || o.occurrenceDate;
          if (seen.has(start)) return; // 何日か続く予定は、はじめの日で1つ
          seen.add(start);
          const end = o.spanEnd && o.spanEnd > start ? o.spanEnd : '';
          if ((end || start) < from) return;
          out.push({ id: `${ev.id}_${start}`, title: ev.title || '', date: start, end, budget, income });
        });
      });
      out.sort((a, b) => a.date.localeCompare(b.date));
      const list = out.slice(0, 300), key = JSON.stringify([st.code, list]);
      if (key === pushedKey) return;
      const d = dbOf();
      if (!d) return;
      pushedKey = key;
      d.collection('kashikari_links').doc(st.code).update({ koukai: list, koukaiAt: Date.now() })
        .catch((e) => { pushedKey = ''; st.error = '送れませんでした（' + (e.code || e.message) + '）'; emit(); });
    }, 1200);
  }

  window.KashikariLink = {
    state: () => ({ ...st }),
    subscribe(fn) { listeners.add(fn); fn({ ...st }); return () => listeners.delete(fn); },
    setCode,
    clear() { setCode(''); },
    // sync.js から：アカウントに覚えてある連携コード
    adopt(code) { if (typeof code === 'string' && code !== st.code && (code === '' || okCode(code))) setCode(code, true); },
    pushKoukai,
  };

  // ?kashikari=コード で開いたとき
  try {
    const u = new URL(window.location.href), c = u.searchParams.get('kashikari');
    if (okCode(c)) {
      setCode(c);
      u.searchParams.delete('kashikari');
      history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams : '') + u.hash);
      window.__kashikariLinked = true;
    }
  } catch (e) {}
  if (st.code) watch(); else emit();
})();
