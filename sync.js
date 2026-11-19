// --- すするanki と同期（Firebase）---
// すするanki のカレンダーと、同じアカウント（Google・メール）で予定を同期する。
// ・Firestore の susuru_anki_cal/{uid} = { events: { id: 予定 }, updatedAt } を、両方のアプリが読み書きする
// ・予定の形はこのアプリの形（title, date, allDay, startTime, endTime, location, notes, recurrence, excludedDates）に、
//   at（変えた時刻）と、すするanki の分（type：テスト・授業など、end：何日か続く予定の最後の日）を足したもの
// ・新しく変えた方（at が大きい方）を使う。消した予定は { deleted: true, at } で知らせる
// ・同期をオンにしたときだけ動く（オフなら今までどおり、この端末の中だけ）
// ・できた事日記（diary.js）も、同じ文書の diary = { 'YYYY-MM-DD': { items, anki, at } } に入れる（日ごとに新しい方を使う）
//   すするanki は events しか読まないので、diary を足してもすするanki には影響しない
(function () {
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyAGoYBRoupEFHng_cXoiHmZf9eAlX8ZCHA', authDomain: 'susuruanki.firebaseapp.com',
    projectId: 'susuruanki', storageBucket: 'susuruanki.firebasestorage.app',
    messagingSenderId: '926791749187', appId: '1:926791749187:web:2a96a39d61cbb4d3c7cef6',
  };
  const ON_KEY = 'koukai-nisshi-sync';
  const DEL_KEY = 'koukai-nisshi-deleted';
  const SHARED = ['title', 'date', 'allDay', 'startTime', 'endTime', 'location', 'notes', 'recurrence', 'excludedDates', 'type', 'end'];

  let auth = null, db = null, user = null, unsub = null, remote = {}, remoteDiary = {}, ready = false, lastError = '';
  let getLocal = () => [], applyLocal = () => {};
  let getDiary = null, applyDiary = () => {};
  const listeners = new Set();

  const isOn = () => { try { return localStorage.getItem(ON_KEY) === '1'; } catch (e) { return false; } };
  const loadDels = () => { try { return JSON.parse(localStorage.getItem(DEL_KEY) || '{}') || {}; } catch (e) { return {}; } };
  const saveDels = (d) => { try { localStorage.setItem(DEL_KEY, JSON.stringify(d)); } catch (e) {} };
  const clean = (o) => JSON.parse(JSON.stringify(o)); // undefined を消す（Firestore は undefined を書けない）

  function state() {
    return {
      available: !!db, on: isOn(), ready, error: lastError,
      user: user ? { name: user.displayName || user.email || '', email: user.email || '' } : null,
      count: Object.values(remote).filter((x) => x && !x.deleted).length,
    };
  }
  function emit() { const s = state(); listeners.forEach((fn) => { try { fn(s); } catch (e) {} }); }

  function toShared(ev) {
    const o = {};
    SHARED.forEach((k) => { if (ev[k] !== undefined) o[k] = ev[k]; });
    o.at = ev.at || 1;
    return clean(o);
  }
  function fromShared(id, r) {
    const ev = { ...r, id };
    delete ev.deleted;
    if (ev.allDay === undefined) ev.allDay = !ev.startTime;
    if (!ev.startTime) ev.startTime = '09:00';
    if (!ev.endTime) ev.endTime = ev.startTime;
    ev.location = ev.location || '';
    ev.notes = ev.notes || '';
    ev.recurrence = ev.recurrence && ev.recurrence.freq && ev.recurrence.freq !== 'none' ? ev.recurrence : null;
    ev.excludedDates = ev.excludedDates || [];
    return ev;
  }

  // 向こうの方が新しい予定をこちらに入れて、こちらの方が新しい予定を向こうに書く
  function merge() {
    const local = getLocal();
    const next = local.slice();
    const dels = loadDels();
    let changed = false;
    Object.entries(remote).forEach(([id, r]) => {
      if (!r) return;
      const i = next.findIndex((e) => e.id === id);
      const lAt = i >= 0 ? (next[i].at || 0) : (dels[id] || 0);
      if ((r.at || 0) <= lAt) return;
      if (r.deleted) { if (i >= 0) { next.splice(i, 1); changed = true; } dels[id] = r.at; }
      else { const ev = fromShared(id, r); if (i >= 0) next[i] = ev; else next.push(ev); delete dels[id]; changed = true; }
    });
    saveDels(dels);
    if (changed) applyLocal(next);
    push(next);
  }
  function push(list) {
    if (!ready || !user || !isOn() || !db) return;
    const up = {};
    (list || getLocal()).forEach((ev) => {
      const r = remote[ev.id];
      if (r && (r.at || 0) >= (ev.at || 1)) return;
      up[ev.id] = toShared(ev);
    });
    Object.entries(loadDels()).forEach(([id, at]) => {
      const r = remote[id];
      if (r && !r.deleted && (r.at || 0) < at) up[id] = { deleted: true, at };
    });
    if (!Object.keys(up).length) return;
    db.collection('susuru_anki_cal').doc(user.uid).set({ events: up, updatedAt: Date.now() }, { merge: true })
      .catch((e) => { lastError = e.code || e.message; emit(); });
  }
  // できた事日記：向こうの方が新しい日をこちらに入れて、こちらの方が新しい日を向こうに書く
  function mergeDiary() {
    if (!getDiary) return;
    const local = getDiary();
    const next = { ...local };
    let changed = false;
    Object.entries(remoteDiary).forEach(([day, r]) => {
      if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
      if ((r.at || 0) <= ((next[day] && next[day].at) || 0)) return;
      next[day] = r; changed = true;
    });
    if (changed) applyDiary(next);
    pushDiary(next);
  }
  function pushDiary(map) {
    if (!ready || !user || !isOn() || !db || !getDiary) return;
    const up = {};
    Object.entries(map || getDiary()).forEach(([day, e]) => {
      if (!e || !e.at) return;
      const r = remoteDiary[day];
      if (r && (r.at || 0) >= e.at) return;
      up[day] = clean({ items: e.items || [], anki: e.anki === undefined ? null : e.anki, at: e.at });
    });
    if (!Object.keys(up).length) return;
    db.collection('susuru_anki_cal').doc(user.uid).set({ diary: up, updatedAt: Date.now() }, { merge: true })
      .catch((e) => { lastError = e.code || e.message; emit(); });
  }

  function start() {
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    ready = false; remote = {}; remoteDiary = {}; lastError = '';
    if (!user || !isOn() || !db) { emit(); return; }
    unsub = db.collection('susuru_anki_cal').doc(user.uid).onSnapshot((snap) => {
      remote = (snap.exists && snap.data().events) || {};
      remoteDiary = (snap.exists && snap.data().diary) || {};
      ready = true; lastError = '';
      merge(); mergeDiary(); emit();
    }, (e) => { ready = false; lastError = e.code || e.message; emit(); });
    emit();
  }

  // Android アプリ：ブラウザでログインして戻ってきたら、アプリが受け取ったトークンでログインする
  // （アプリが裏で閉じられて開き直したときも、ページを開いたときにここで受け取る）
  function takeNativeLogin() {
    const A = window.KoukaiApp;
    if (!A || !A.takeLogin || !auth) return;
    let t = null;
    try { t = JSON.parse(A.takeLogin() || 'null'); } catch (e) { t = null; }
    if (!t) return;
    const wait = window.__koukaiNativeLogin; window.__koukaiNativeLogin = null;
    if (!t.idToken) { if (wait) wait.reject(new Error(t.error || 'ログインできませんでした')); return; }
    auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(t.idToken, t.accessToken || null))
      .then((r) => { if (wait) wait.resolve(r); },
        (e) => { if (wait) wait.reject(e); else { lastError = e.code || e.message; emit(); } });
  }
  window.__koukaiLoginArrived = takeNativeLogin;

  function init() {
    if (!window.firebase || !firebase.initializeApp) return;
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth(); db = firebase.firestore();
      auth.onAuthStateChanged((u) => { user = u; start(); });
      auth.getRedirectResult().catch(() => {});
      takeNativeLogin();
    } catch (e) { lastError = e.message; }
  }

  window.VoyageSync = {
    // アプリ（VoyageLog.jsx）から：今の予定を読む関数と、予定を入れかえる関数
    attach(getFn, applyFn) { getLocal = getFn; applyLocal = applyFn; if (ready) merge(); },
    // 保存の前に呼ぶ：変わった予定に at を付け、消えた予定を覚える。at を付けた一覧を返す
    stamp(prev, next) {
      const prevById = Object.fromEntries((prev || []).map((e) => [e.id, e]));
      const now = Date.now();
      const out = next.map((ev) => {
        const p = prevById[ev.id];
        const same = p && JSON.stringify({ ...p, at: 0 }) === JSON.stringify({ ...ev, at: 0 });
        return same ? ev : { ...ev, at: now };
      });
      const ids = new Set(next.map((e) => e.id));
      const dels = loadDels();
      (prev || []).forEach((e) => { if (!ids.has(e.id)) dels[e.id] = now; });
      saveDels(dels);
      return out;
    },
    push,
    // できた事日記（diary.js）：今の日記を読む関数と、日記を入れかえる関数
    attachDiary(getFn, applyFn) { getDiary = getFn; applyDiary = applyFn; if (ready) mergeDiary(); },
    pushDiary,
    subscribe(fn) { listeners.add(fn); fn(state()); return () => listeners.delete(fn); },
    state,
    setOn(on) { try { localStorage.setItem(ON_KEY, on ? '1' : '0'); } catch (e) {} start(); },
    async signInGoogle() {
      if (!auth) throw new Error('Firebase を読み込めませんでした');
      // Android アプリ（WebView）の中では Google がログインを許さないので、ブラウザでログインして戻ってくる（app-login.html）
      if (window.KoukaiApp && window.KoukaiApp.googleSignIn) {
        return new Promise((resolve, reject) => {
          window.__koukaiNativeLogin = { resolve, reject };
          window.KoukaiApp.googleSignIn();
        });
      }
      const p = new firebase.auth.GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      try { await auth.signInWithPopup(p); }
      catch (e) {
        if (/popup|operation-not-supported|web-storage/.test(e.code || '')) return auth.signInWithRedirect(p);
        throw e;
      }
    },
    async signInEmail(email, pw) { if (!auth) throw new Error('Firebase を読み込めませんでした'); return auth.signInWithEmailAndPassword(email, pw); },
    async signOut() { if (auth) await auth.signOut(); },
  };
  init();
})();
