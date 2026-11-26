// --- メインコンポーネント ---
// 依存: constants.js, date-utils.js, recurrence.js, ics-export.js, calendar-grid.js, diary.js, anki-feeds.js, stars.js, planner.js, app-bridge.js, icons.jsx, planner-ui.jsx（gcal.js・sync.js・kashikari-link.js は window から）

const { useState, useEffect, useMemo, useCallback, useRef } = React;

// すするanki から届いた予定の種類（テスト・授業など）の印
const TYPE_ICONS = { class: '📚', test: '📝', exam: '🗓️', deadline: '⏰' };
const NO_FEEDS = [];

const emptyForm = (dateStr) => ({
  id: null,
  title: '',
  date: dateStr,
  end: '', // 何日か続く予定の最後の日（1日だけなら空）
  star: false, // ★ 重要な予定（「★ 大事な予定」の一覧・ウィジェットに、あと何日を出す）
  allDay: false,
  startTime: '09:00',
  endTime: '10:00',
  location: '',
  notes: '',
  recurrence: emptyRecurrence(),
  excludedDates: [],
  budget: '', // かかりそうなお金（予算）。貸し借り帳の見通しに入る
  income: '', // 入るお金（単発バイトなど）
});
// 金額の入力（全角・カンマ・円・「4000+2000」の足し算もOK）→ 数（0 なら null）
const moneyOf = (s) => {
  const t = String(s ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[＋]/g, '+').replace(/[,，¥￥円\s]/g, '');
  const v = (t.match(/\d+/g) || []).reduce((a, x) => a + parseInt(x, 10), 0);
  return v > 0 ? Math.min(v, 1e9) : null;
};
const yenOf = (n) => '¥' + Math.round(n || 0).toLocaleString('ja-JP');

function VoyageLog() {
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const now0 = new Date();
  const [viewYear, setViewYear] = useState(now0.getFullYear());
  const [viewMonth, setViewMonth] = useState(now0.getMonth());
  const [selectedKey, setSelectedKey] = useState(todayKey());
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm(todayKey()));
  const [confirmDelete, setConfirmDelete] = useState(null); // { masterId, occurrenceDate, isRecurring }
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  // すするanki と同期（sync.js）
  const eventsRef = useRef([]);
  eventsRef.current = events;
  const [sync, setSync] = useState(window.VoyageSync ? window.VoyageSync.state() : null);
  // 貸し借り帳と連携（kashikari-link.js）
  const [kl, setKl] = useState(window.KashikariLink ? window.KashikariLink.state() : null);
  const [klCode, setKlCode] = useState('');
  useEffect(() => (window.KashikariLink ? window.KashikariLink.subscribe(setKl) : undefined), []);
  // 📆 Googleカレンダーと同期（gcal.js）
  const [gc, setGc] = useState(window.KoukaiGcal ? window.KoukaiGcal.state() : null);
  useEffect(() => (window.KoukaiGcal ? window.KoukaiGcal.subscribe(setGc) : undefined), []);
  const [syncOpen, setSyncOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPw, setLoginPw] = useState('');
  // できた事日記（diary.js）
  const [diary, setDiary] = useState(() => loadDiary());
  const diaryRef = useRef(diary);
  diaryRef.current = diary;
  const diaryPushTimer = useRef(null);
  const diarySection = useRef(null);
  const diaryFirstInput = useRef(null);
  const [diarySaved, setDiarySaved] = useState(false);
  const diarySavedTimer = useRef(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  // ✅ タスク・🧭 目標（planner.js）。{ id: 中身 }（消したものは { deleted: true, at }）
  const [tab, setTab] = useState('cal'); // cal | tasks | plan
  const [tasksMap, setTasksMap] = useState(() => loadMap(TASKS_KEY));
  const [goalsMap, setGoalsMap] = useState(() => loadMap(GOALS_KEY));
  const tasksRef = useRef(tasksMap); tasksRef.current = tasksMap;
  const goalsRef = useRef(goalsMap); goalsRef.current = goalsMap;
  const [taskEdit, setTaskEdit] = useState(null);
  const [goalEdit, setGoalEdit] = useState(null);
  const tasks = useMemo(() => liveList(tasksMap), [tasksMap]);
  const goals = useMemo(() => liveList(goalsMap), [goalsMap]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (mounted && raw) {
          const list = JSON.parse(raw);
          eventsRef.current = list;
          setEvents(list);
        }
      } catch (err) {
        // no saved events yet — fine to start with an empty log
      } finally {
        if (mounted) setLoaded(true);
        // 同期：向こうで変わった予定が届いたら、ここの予定を入れかえる
        if (mounted && window.VoyageSync) {
          window.VoyageSync.attach(() => eventsRef.current, (next) => {
            eventsRef.current = next;
            setEvents(next);
            try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (e) {}
          });
          // できた事日記も同期：向こうで書いた日が届いたら入れかえる
          window.VoyageSync.attachDiary(() => diaryRef.current, (raw) => {
            const next = {};
            Object.keys(raw).forEach((k) => { next[k] = normalizeDiaryEntry(raw[k]); });
            diaryRef.current = next;
            setDiary(next);
            saveDiaryLocal(next);
          });
          // タスク・目標も同期：向こうで変わったものが届いたら入れかえる
          window.VoyageSync.attachMap('tasks', () => tasksRef.current, (next) => { tasksRef.current = next; setTasksMap(next); saveMap(TASKS_KEY, next); });
          window.VoyageSync.attachMap('goals', () => goalsRef.current, (next) => { goalsRef.current = next; setGoalsMap(next); saveMap(GOALS_KEY, next); });
        }
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (diaryPushTimer.current) clearTimeout(diaryPushTimer.current);
      if (diarySavedTimer.current) clearTimeout(diarySavedTimer.current);
    };
  }, []);

  // Android アプリ：予定や日記が変わったら、ホーム画面のウィジェットに渡す
  // すするanki の見るだけの予定（URL で購読したカレンダー・グループの予定。sync.js が読む）
  const ankiFeeds = (sync && sync.feeds) || NO_FEEDS;
  // 貸し借り帳の見るだけの予定（定期の収入・支払い、返す期限、🎟 予定）も、すするanki の見るだけの予定と同じようにカレンダーに出す
  const klFeeds = (kl && kl.feedItems) || NO_FEEDS;
  // Googleカレンダーの予定（選んだカレンダー。見るだけ）も
  const gcFeeds = (gc && gc.feedItems) || NO_FEEDS;
  const feeds = useMemo(() => (klFeeds.length || gcFeeds.length ? ankiFeeds.concat(klFeeds, gcFeeds) : ankiFeeds), [ankiFeeds, klFeeds, gcFeeds]);
  // 航海日誌の予定を Googleカレンダー（「航海日誌」カレンダー）に書く：予定が変わったら少し待って送る
  // Google の「航海日誌」カレンダーで直された予定は、persist で航海日誌に入れる（ほかの端末・すするanki にも届く）
  const persistRef = useRef(null);
  useEffect(() => { if (window.KoukaiGcal) window.KoukaiGcal.attach(() => eventsRef.current, (next) => (persistRef.current ? persistRef.current(next) : null)); }, []);
  useEffect(() => { if (loaded && window.KoukaiGcal) window.KoukaiGcal.changed(); }, [events, loaded]);
  // 予算・入るお金のついた予定を、貸し借り帳に送る
  useEffect(() => { if (loaded && window.KashikariLink) window.KashikariLink.pushKoukai(events); }, [events, loaded, kl && kl.code, kl && kl.ready]);
  useEffect(() => { if (window.__kashikariLinked) { window.__kashikariLinked = false; showToast('💰 貸し借り帳と連携しました'); } }, []);
  useEffect(() => { if (loaded) koukaiSendWidget(events, diary, feeds); }, [events, diary, feeds, loaded]);

  // 日記の欄へ移る（ウィジェットの「できた事を書く」・?view=diary から）
  const openDiary = useCallback((key) => {
    const k = key || todayKey();
    const { year, month } = parseDateKey(k);
    setViewYear(year); setViewMonth(month);
    setSelectedKey(k);
    setConfirmDelete(null);
    setTimeout(() => {
      if (diarySection.current) diarySection.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const e = diaryRef.current[k];
      if (diaryFirstInput.current && diaryDoneCount(e) < DIARY_SLOTS) diaryFirstInput.current.focus();
    }, 250);
  }, []);
  // その日を開く（ウィジェットのカレンダーの日・今日）
  const openDay = useCallback((key) => {
    const k = /^\d{4}-\d{2}-\d{2}$/.test(key || '') ? key : todayKey();
    const { year, month } = parseDateKey(k);
    setViewYear(year); setViewMonth(month);
    setSelectedKey(k);
    setConfirmDelete(null);
  }, []);
  useEffect(() => {
    window.__koukaiOpen = (view, key) => {
      setModalOpen(false); setReviewOpen(false); setSyncOpen(false); setTaskEdit(null); setGoalEdit(null);
      if (view === 'tasks' || view === 'plan') { setTab(view); return; }
      setTab('cal');
      if (view === 'diary') openDiary(key || undefined);
      else openDay(view === 'day' ? key : '');
    };
    const sv = koukaiStartView();
    if (sv.view === 'diary') openDiary();
    else if (sv.view === 'day') openDay(sv.date);
    else if (sv.view === 'tasks' || sv.view === 'plan') setTab(sv.view);
    // 読み込み直しても同じ画面に飛ばないように、URL から view・date を消しておく
    if (sv.view) {
      try {
        const u = new URL(window.location.href);
        u.searchParams.delete('view'); u.searchParams.delete('date');
        window.history.replaceState(null, '', u.toString());
      } catch (e) {}
    }
    return () => { window.__koukaiOpen = null; };
  }, [openDiary, openDay]);

  // Android アプリの自動更新：ダウンロードできたら知らせが来る。確認が要るときだけ、上に「📲 アプリを更新」を出す
  const [apk, setApk] = useState(() => (typeof koukaiApk !== 'undefined' ? koukaiApk : { ready: false, silent: false }));
  useEffect(() => {
    const on = (e) => setApk(e.detail);
    window.addEventListener('koukai-apk', on);
    return () => window.removeEventListener('koukai-apk', on);
  }, []);
  // 予定を書いている途中・ログインの途中は、アプリを閉じても入れ替えない
  useEffect(() => { koukaiApkSetIdle(!modalOpen && !syncOpen && !taskEdit && !goalEdit); }, [modalOpen, syncOpen, taskEdit, goalEdit]);

  // Android アプリの戻るボタン：開いている画面を閉じる（閉じたら true）
  const openLayers = useRef({});
  openLayers.current = { modalOpen, reviewOpen, syncOpen, taskEdit, goalEdit, tab };
  useEffect(() => {
    window.koukaiAppBack = () => {
      const o = openLayers.current;
      if (o.taskEdit) { setTaskEdit(null); return true; }
      if (o.goalEdit) { setGoalEdit(null); return true; }
      if (o.modalOpen) { setModalOpen(false); return true; }
      if (o.reviewOpen) { setReviewOpen(false); return true; }
      if (o.syncOpen) { setSyncOpen(false); return true; }
      if (o.tab !== 'cal') { setTab('cal'); return true; }
      return false;
    };
    return () => { window.koukaiAppBack = null; };
  }, []);


  useEffect(() => (window.VoyageSync ? window.VoyageSync.subscribe(setSync) : undefined), []);

  const showToast = useCallback((message, type = 'ok') => {
    setToast({ message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  // 日記を1日ぶん書きかえる（この端末にはすぐ保存、同期は打ち終わってから送る）
  const updateDiary = useCallback((key, patch, opts = {}) => {
    const prev = diaryRef.current[key] || emptyDiaryEntry();
    const entry = { ...prev, ...patch, at: Date.now() };
    const next = { ...diaryRef.current, [key]: entry };
    diaryRef.current = next;
    setDiary(next);
    if (!saveDiaryLocal(next)) { showToast('日記を保存できませんでした', 'error'); return; }
    if (!opts.silent) setDiarySaved(true);
    if (diarySavedTimer.current) clearTimeout(diarySavedTimer.current);
    diarySavedTimer.current = setTimeout(() => setDiarySaved(false), 1500);
    if (diaryPushTimer.current) clearTimeout(diaryPushTimer.current);
    diaryPushTimer.current = setTimeout(() => { if (window.VoyageSync) window.VoyageSync.pushDiary(diaryRef.current); }, 1200);
  }, [showToast]);

  // ---- タスク・目標を書きかえる（変えたものに at を付けて、この端末に保存し、同期で送る）----
  const writeMap = useCallback((kind, id, value) => {
    const isTask = kind === 'tasks';
    const ref = isTask ? tasksRef : goalsRef;
    const next = { ...ref.current, [id]: { ...value, at: Date.now() } };
    delete next[id].id;
    ref.current = next;
    (isTask ? setTasksMap : setGoalsMap)(next);
    if (!saveMap(isTask ? TASKS_KEY : GOALS_KEY, next)) showToast('保存に失敗しました', 'error');
    if (window.VoyageSync) window.VoyageSync.pushMap(kind, next);
  }, [showToast]);
  const saveTask = useCallback((t) => {
    const id = t.id || generateId();
    const prev = tasksRef.current[id] || {};
    writeMap('tasks', id, { ...prev, ...t, done: !!t.done, doneAt: t.done ? (prev.doneAt || Date.now()) : 0 });
    if (t.alarm !== null && t.alarm !== undefined && t.due) koukaiAskNotifPermission();
    return id;
  }, [writeMap]);
  const toggleTask = useCallback((t) => {
    const done = !t.done;
    writeMap('tasks', t.id, { ...tasksRef.current[t.id], done, doneAt: done ? Date.now() : 0 });
    if (done) showToast('✅ よくできました');
  }, [writeMap, showToast]);
  const deleteTask = useCallback((t) => { writeMap('tasks', t.id, { deleted: true }); setTaskEdit(null); showToast('タスクを消しました'); }, [writeMap, showToast]);
  const saveGoal = useCallback((g) => { const id = g.id || generateId(); writeMap('goals', id, { ...g }); setGoalEdit(null); showToast('保存しました'); }, [writeMap, showToast]);
  const deleteGoal = useCallback((g) => {
    if (!window.confirm(`「${g.title}」を消しますか？（ステップのタスクは残ります）`)) return;
    writeMap('goals', g.id, { deleted: true });
    // ステップのタスクは、ふつうのタスクとして残す
    Object.entries(tasksRef.current).forEach(([id, t]) => { if (t && !t.deleted && t.goalId === g.id) writeMap('tasks', id, { ...t, goalId: '' }); });
    setGoalEdit(null); showToast('目標を消しました');
  }, [writeMap, showToast]);
  const addGoalSteps = useCallback((g, steps) => {
    steps.forEach((st, i) => writeMap('tasks', generateId() + i, { ...emptyTask(st.due), title: st.title, goalId: g.id, done: false }));
    showToast(`ステップを${steps.length}個足しました`);
  }, [writeMap, showToast]);

  const persist = useCallback(async (nextEvents) => {
    // 同期：変わった予定に「変えた時刻」を付けてから保存し、すするanki 側にも送る
    const stamped = window.VoyageSync ? window.VoyageSync.stamp(eventsRef.current, nextEvents) : nextEvents;
    eventsRef.current = stamped;
    setEvents(stamped);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped));
    } catch (err) {
      showToast('保存に失敗しました', 'error');
    }
    if (window.VoyageSync) window.VoyageSync.push(stamped);
  }, [showToast]);

  const [loginErr, setLoginErr] = useState('');
  const runSync = async (fn, okMsg) => {
    setLoginErr('');
    try { await fn(); if (okMsg) showToast(okMsg); }
    catch (e) {
      // アプリのログインで断られたときは、わけと次にすることを、ダイアログに残しておく
      if (String(e.code || '').startsWith('app/')) { setLoginErr(e.message); if (e.code === 'app/cancelled') return; }
      showToast(`できませんでした（${e.code || e.message}）`, 'error');
    }
  };

  const gridCells = useMemo(() => getMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  // 表示中のカレンダーグリッドと選択日を必ずカバーする範囲で繰り返し予定を展開する
  const occurrenceRange = useMemo(() => {
    const gridStart = gridCells[0]?.key || selectedKey;
    const gridEnd = gridCells[gridCells.length - 1]?.key || selectedKey;
    const start = [gridStart, selectedKey].sort()[0];
    const end = [gridEnd, selectedKey].sort()[1];
    return { start, end };
  }, [gridCells, selectedKey]);

  const eventsByDate = useMemo(() => {
    const map = {};
    for (const ev of events) {
      const occurrences = expandEventOccurrences(ev, occurrenceRange.start, occurrenceRange.end);
      for (const occ of occurrences) {
        if (!map[occ.occurrenceDate]) map[occ.occurrenceDate] = [];
        map[occ.occurrenceDate].push(occ);
      }
    }
    for (const occ of ankiFeedOccurrences(feeds, occurrenceRange.start, occurrenceRange.end)) {
      if (!map[occ.occurrenceDate]) map[occ.occurrenceDate] = [];
      map[occ.occurrenceDate].push(occ);
    }
    for (const key in map) {
      map[key].sort((a, b) => {
        if (a.allDay && !b.allDay) return -1;
        if (!a.allDay && b.allDay) return 1;
        return (a.startTime || '').localeCompare(b.startTime || '');
      });
    }
    return map;
  }, [events, feeds, occurrenceRange]);
  const selectedEvents = eventsByDate[selectedKey] || [];
  const todayStr = todayKey();
  // ★ 大事な予定（いちばん近い回。stars.js）
  const starList = useMemo(() => starUpcoming(events, feeds, todayStr), [events, feeds, todayStr]);
  // その日が期限のタスク・カレンダーの印
  const tasksByDue = useMemo(() => { const m = {}; tasks.forEach((t) => { if (t.due) (m[t.due] = m[t.due] || []).push(t); }); return m; }, [tasks]);
  const selTasks = sortTasks(tasksByDue[selectedKey] || []);
  const openTaskCount = tasks.filter((t) => !t.done).length;
  const overdueCount = tasks.filter((t) => taskGroup(t, todayStr) === 'overdue').length;

  // 🔔 アラーム：Android アプリはアプリに渡して、閉じていても鳴らす。ブラウザは開いている間だけ（app-bridge.js）
  useEffect(() => { if (loaded) koukaiSetAlarms(alarmList(tasks, goals)); }, [tasks, goals, loaded]);
  // 通知の「完了にする」で完了にしたタスク（アプリが覚えておいたもの）を受け取る
  useEffect(() => {
    const take = () => koukaiTakeDoneTasks().forEach((id) => {
      const t = tasksRef.current[id];
      if (t && !t.deleted && !t.done) writeMap('tasks', id, { ...t, done: true, doneAt: Date.now() });
    });
    take();
    const onVis = () => { if (document.visibilityState === 'visible') take(); };
    document.addEventListener('visibilitychange', onVis);
    window.__koukaiTasksDone = take;
    return () => { document.removeEventListener('visibilitychange', onVis); window.__koukaiTasksDone = null; };
  }, [writeMap]);
  // ブラウザで鳴ったとき：画面にも出す
  useEffect(() => {
    window.__koukaiAlarmToast = (title) => showToast(title);
    return () => { window.__koukaiAlarmToast = null; };
  }, [showToast]);
  const selDiary = diary[selectedKey] || emptyDiaryEntry();
  const selDone = diaryDoneCount(selDiary);
  const isFutureDay = selectedKey > todayStr;
  const diaryStreakDays = useMemo(() => diaryStreak(diary, todayStr), [diary, todayStr]);
  // すするanki の記録（その日に解いた数・正解数）。ログインしていれば sync.js が読む。日記に入れるのは解いた数（answered）
  const ankiLogs = (sync && sync.ankiLogs) || {};
  const selAnkiLog = ankiLogs[selectedKey] || null;
  const loggedIn = !!(sync && sync.user);
  useEffect(() => {
    if (loggedIn && window.VoyageSync && window.VoyageSync.askAnkiDay) window.VoyageSync.askAnkiDay(selectedKey);
  }, [loggedIn, selectedKey]);
  // 自動で入れる：今日と、できた事を書いた日だけ（見ただけの日に日記を作らない）。自分で入れた数（ankiAuto: false）は上書きしない
  useEffect(() => {
    Object.entries(ankiLogs).forEach(([day, log]) => {
      if (!log || day > todayStr) return;
      const e = diaryRef.current[day] || emptyDiaryEntry();
      if (e.ankiAuto === false) return;
      if (day !== todayStr && diaryDoneCount(e) === 0) return;
      if (log.answered === 0 && e.anki === null) return;
      if (e.anki === log.answered && e.ankiAuto === true) return;
      updateDiary(day, { anki: log.answered, ankiAuto: true }, { silent: true });
    });
  }, [ankiLogs, diary, todayStr, updateDiary]);

  const selectDay = (key) => {
    setSelectedKey(key);
    setConfirmDelete(null);
  };

  const goPrevMonth = () => {
    let m = viewMonth - 1, y = viewYear;
    if (m < 0) { m = 11; y -= 1; }
    setViewMonth(m); setViewYear(y);
  };
  const goNextMonth = () => {
    let m = viewMonth + 1, y = viewYear;
    if (m > 11) { m = 0; y += 1; }
    setViewMonth(m); setViewYear(y);
  };
  const goToday = () => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    selectDay(todayKey());
  };

  // 見るだけの予定（Google・すするanki・貸し借り帳）を、直せる自分の予定にする（その回だけ）
  const copyToMine = (ev) => {
    const d = ev.instanceDate || ev.occurrenceDate || ev.date;
    setForm({ ...emptyForm(d), title: ev.title || '', end: ev.spanEnd && ev.spanEnd > d ? ev.spanEnd : '', allDay: !!ev.allDay,
      startTime: ev.startTime || '09:00', endTime: ev.endTime || ev.startTime || '10:00', location: ev.location || '', notes: ev.notes || '' });
    setModalOpen(true);
  };
  const openAddModal = (dateStr) => {
    setForm(emptyForm(dateStr || selectedKey));
    setModalOpen(true);
  };
  const openEditModal = (ev) => {
    // evは展開済みの発生インスタンス。編集は常にマスター予定に対して行う
    const master = events.find((e) => e.id === ev.masterId) || ev;
    setForm({
      id: master.id,
      title: master.title,
      date: master.date,
      end: master.end && master.end > master.date ? master.end : '',
      star: !!master.star,
      allDay: master.allDay,
      startTime: master.startTime,
      endTime: master.endTime,
      location: master.location,
      notes: master.notes,
      recurrence: master.recurrence ? { ...emptyRecurrence(), ...master.recurrence, daysOfWeek: [...(master.recurrence.daysOfWeek || [])] } : emptyRecurrence(),
      excludedDates: master.excludedDates || [],
      budget: master.budget ? String(master.budget) : '',
      income: master.income ? String(master.income) : '',
      _editingOccurrenceDate: ev.occurrenceDate,
    });
    setModalOpen(true);
  };
  const closeModal = () => setModalOpen(false);

  persistRef.current = persist;

  // Google のほかのカレンダーの予定を、航海日誌から直す・消す（gcal.js）
  const openGcalEdit = (ev) => {
    const d = ev.instanceDate || ev.occurrenceDate || ev.date;
    setForm({ ...emptyForm(d), title: ev.title || '', end: ev.spanEnd && ev.spanEnd > d ? ev.spanEnd : '', allDay: !!ev.allDay,
      startTime: ev.startTime || '09:00', endTime: ev.endTime || ev.startTime || '10:00', location: ev.location || '', notes: ev.notes || '', _gcal: ev.gcal });
    setModalOpen(true);
  };
  const deleteGcalEvent = async (ev) => {
    if (!window.confirm(`Googleカレンダー（${ev.gcal.calName}）の「${ev.title}」を消しますか？${ev.gcal.recurring ? '\n（繰り返しの予定は、この回だけ消します）' : ''}`)) return;
    try { await window.KoukaiGcal.deleteGoogleEvent(ev.gcal); showToast('Googleカレンダーから消しました'); }
    catch (e) { showToast(`消せませんでした（${e.message}）`, 'error'); }
  };

  const handleSave = async () => {
    if (form._gcal) {
      if (!form.title.trim()) { showToast('タイトルを入力してください', 'error'); return; }
      if (form.end && form.end < form.date) { showToast('最後の日は、はじめの日より後にしてください', 'error'); return; }
      try {
        await window.KoukaiGcal.saveGoogleEvent({ ...form._gcal, title: form.title.trim(), date: form.date, end: form.end && form.end > form.date ? form.end : '',
          allDay: form.allDay, startTime: form.startTime, endTime: form.endTime, location: form.location, notes: form.notes });
        setModalOpen(false); showToast('Googleカレンダーを直しました');
      } catch (e) { showToast(`直せませんでした（${e.message}）`, 'error'); }
      return;
    }
    if (!form.title.trim()) {
      showToast('タイトルを入力してください', 'error');
      return;
    }
    if (form.recurrence.freq !== 'none' && form.recurrence.endType === 'until' && form.recurrence.endDate && form.recurrence.endDate < form.date) {
      showToast('繰り返しの終了日は開始日より後にしてください', 'error');
      return;
    }
    const endDay = form.end && form.end > form.date ? form.end : '';
    if (form.end && form.end < form.date) {
      showToast('最後の日は、はじめの日より後にしてください', 'error');
      return;
    }
    // 何日か続く予定を繰り返すとき：1回の長さが、次の回までの間より短いこと（重ならないように）
    if (endDay && form.recurrence.freq !== 'none') {
      const span = eventSpanDays({ date: form.date, end: endDay });
      const iv = Math.max(1, parseInt(form.recurrence.interval, 10) || 1);
      let gap = { daily: iv, weekly: 7 * iv, monthly: 28 * iv, yearly: 365 * iv }[form.recurrence.freq] || 1;
      if (form.recurrence.freq === 'weekly' && form.recurrence.daysOfWeek.length > 1) {
        const ds = [...form.recurrence.daysOfWeek].sort((a, b) => a - b);
        ds.forEach((d, i) => { gap = Math.min(gap, i + 1 < ds.length ? ds[i + 1] - d : ds[0] + 7 - d); });
      }
      if (span >= gap) {
        showToast(`${span + 1}日続く予定は、この繰り返しだと次の回と重なります`, 'error');
        return;
      }
    }

    const recurrenceToSave = form.recurrence && form.recurrence.freq !== 'none'
      ? {
          freq: form.recurrence.freq,
          interval: Math.max(1, parseInt(form.recurrence.interval, 10) || 1),
          daysOfWeek: form.recurrence.freq === 'weekly' ? [...form.recurrence.daysOfWeek].sort() : [],
          endType: form.recurrence.endType,
          endDate: form.recurrence.endType === 'until' ? form.recurrence.endDate : null,
          endCount: form.recurrence.endType === 'count' ? Math.max(1, parseInt(form.recurrence.endCount, 10) || 1) : null,
        }
      : null;

    const baseData = {
      title: form.title.trim(),
      date: form.date,
      end: endDay,
      allDay: form.allDay,
      startTime: form.startTime,
      endTime: form.endTime,
      location: form.location,
      notes: form.notes,
      recurrence: recurrenceToSave,
      excludedDates: recurrenceToSave || endDay ? (form.excludedDates || []) : [],
      star: !!form.star,
      budget: moneyOf(form.budget),
      income: moneyOf(form.income),
    };

    let next;
    if (form.id) {
      next = events.map((ev) => (ev.id === form.id ? { ...ev, ...baseData } : ev));
    } else {
      next = [...events, { ...baseData, id: generateId() }];
    }
    await persist(next);
    setModalOpen(false);
    showToast('保存しました');
  };

  const handleDeleteSeries = async (id) => {
    const next = events.filter((ev) => ev.id !== id);
    await persist(next);
    setConfirmDelete(null);
    showToast('削除しました');
  };

  const handleDeleteOccurrence = async (masterId, occurrenceDate) => {
    const next = events.map((ev) =>
      ev.id === masterId
        ? { ...ev, excludedDates: [...new Set([...(ev.excludedDates || []), occurrenceDate])] }
        : ev
    );
    await persist(next);
    setConfirmDelete(null);
    showToast('この回を削除しました');
  };

  const handleExportOne = (ev) => {
    // 繰り返し予定の場合、この一覧項目が指す「その回」だけを単発の予定として書き出す
    const single = ev.isRecurring
      ? { ...ev, id: `${ev.masterId}-${ev.instanceDate || ev.occurrenceDate}`, date: ev.instanceDate || ev.occurrenceDate, end: ev.spanEnd && ev.spanEnd > (ev.instanceDate || '') ? ev.spanEnd : '', recurrence: null, excludedDates: [] }
      : ev;
    const ics = buildICS([single]);
    downloadICS(`${sanitizeFilename(ev.title)}.ics`, ics);
    showToast('.icsを書き出しました');
  };

  const handleExportAll = () => {
    if (events.length === 0) {
      showToast('書き出す予定がありません', 'error');
      return;
    }
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    downloadICS(`予定一覧_${stamp}.ics`, buildICS(events));
    showToast(`${events.length}件を書き出しました`);
  };

  return (
    <div className="voyage-log min-h-screen w-full flex items-center justify-center p-3 sm:p-6">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap');

        .voyage-log {
          --ink-deep: #131E29;
          --ink-panel: #1D2E3D;
          --ink-panel-2: #25394B;
          --brass: #C9A15C;
          --brass-bright: #E3C384;
          --chart-line: #3C5A6E;
          --parchment: #EDE6D2;
          --parchment-dim: #97A8B5;
          --signal: #7FB69E;
          --danger: #C0605A;
          background: var(--ink-deep);
          font-family: 'IBM Plex Sans', sans-serif;
          color: var(--parchment);
        }
        .voyage-log .font-display { font-family: 'Fraunces', serif; }
        .voyage-log .font-mono { font-family: 'IBM Plex Mono', monospace; }

        .voyage-log .compass-mark {
          animation: compass-drift 220s linear infinite;
          transform-origin: 50% 50%;
        }
        @keyframes compass-drift {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .voyage-log .compass-mark { animation: none; }
        }

        .voyage-log button { font-family: inherit; cursor: pointer; }
        .voyage-log button:focus-visible,
        .voyage-log input:focus-visible,
        .voyage-log textarea:focus-visible {
          outline: 2px solid var(--brass-bright);
          outline-offset: 2px;
        }

        .voyage-log .day-cell { transition: background-color 0.15s ease; }
        .voyage-log .day-cell:hover { background-color: var(--ink-panel-2); }

        .voyage-log .field input,
        .voyage-log .field textarea {
          background: #fff;
          border: 1px solid var(--chart-line);
          color: var(--ink-deep);
        }
        .voyage-log .field input:focus,
        .voyage-log .field textarea:focus { outline: 2px solid var(--brass); outline-offset: 0; }

        .voyage-log ::selection { background: var(--brass); color: var(--ink-deep); }

        .voyage-log .diary-input {
          background: var(--ink-deep);
          border: 1px solid var(--chart-line);
          color: var(--parchment);
        }
        .voyage-log .diary-input::placeholder { color: #5E7180; }
        .voyage-log .diary-input:focus { outline: 2px solid var(--brass); outline-offset: 0; }
        .voyage-log .diary-input:disabled { opacity: 0.45; }
      `}</style>

      <div className="w-full max-w-lg">
      {kl && kl.code && kl.warn && kl.warn.label && (
        <div className="mb-3 rounded-xl px-4 py-3" style={{ background: '#3A1F22', border: '1px solid #C0605A', color: '#F2C5C1' }} role="alert">
          <p className="text-xs leading-relaxed"><b>{kl.warn.label}</b><br />貸し借り帳の見通しより（予定の予算・入るお金・定期の支払いから）。貸し借り帳の「🎟 予定」で、くわしく見られます。</p>
        </div>
      )}
      {apk.ready && !apk.silent && koukaiAppOutdated() && (
        <div className="mb-3 rounded-xl px-4 py-3 flex items-center gap-3" style={{ background: 'var(--brass)', color: 'var(--ink-deep)' }}>
          <p className="text-xs flex-1 leading-relaxed">
            <b>📲 新しいアプリがあります</b><br />今回だけ確認が出ます。次からは、アプリを閉じたときに自動で更新されます（予定・日記はそのまま）。
          </p>
          <button onClick={() => koukaiInstallApk()} className="shrink-0 text-xs font-semibold px-3 py-2 rounded-lg" style={{ background: 'var(--ink-deep)', color: 'var(--parchment)' }}>
            更新する
          </button>
        </div>
      )}
      <div className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl" style={{ background: 'var(--ink-panel)', border: '1px solid var(--chart-line)' }}>
        <div className="relative px-5 pt-5 pb-4 overflow-hidden" style={{ borderBottom: '1px solid var(--chart-line)' }}>
          <svg className="compass-mark absolute -top-8 -right-8 opacity-10 pointer-events-none" width="150" height="150" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="46" fill="none" stroke="var(--brass)" strokeWidth="1" />
            <circle cx="50" cy="50" r="37" fill="none" stroke="var(--brass)" strokeWidth="0.5" />
            <line x1="50" y1="4" x2="50" y2="96" stroke="var(--brass)" strokeWidth="0.5" />
            <line x1="4" y1="50" x2="96" y2="50" stroke="var(--brass)" strokeWidth="0.5" />
            <polygon points="50,10 56,50 50,90 44,50" fill="var(--brass)" />
          </svg>

          <div className="relative flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Anchor size={18} style={{ color: 'var(--brass)' }} aria-hidden="true" />
              <h1 className="font-display text-lg tracking-wide">航海日誌</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSyncOpen(true)}
                className="font-mono text-xs px-2.5 py-1.5 rounded-md"
                style={{ color: sync && sync.on && sync.ready ? 'var(--ink-deep)' : 'var(--brass-bright)', border: '1px solid var(--chart-line)', background: sync && sync.on && sync.ready ? 'var(--brass)' : 'transparent' }}
                aria-label="同期とログイン"
              >
                {!sync || !sync.user ? '☁️ ログイン' : !sync.on ? '☁️ 同期オフ' : sync.error ? '⚠️ 同期' : !sync.online ? '📴 オフライン' : sync.pending ? '☁️ 送信中…' : sync.ready ? '☁️ 同期中' : '☁️ 同期'}
              </button>
              <button
                onClick={goToday}
                className="font-mono text-xs px-2.5 py-1.5 rounded-md"
                style={{ color: 'var(--brass-bright)', border: '1px solid var(--chart-line)', background: 'transparent' }}
              >
                今日
              </button>
            </div>
          </div>

          <div className="relative flex mt-4 rounded-lg p-0.5" style={{ background: 'var(--ink-deep)', border: '1px solid var(--chart-line)' }} role="tablist">
            {[['cal', '📅 カレンダー', 0], ['tasks', '✅ タスク', openTaskCount], ['plan', '🧭 計画', goals.length]].map(([k, l, n]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className="flex-1 py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1"
                style={{ background: tab === k ? 'var(--brass)' : 'transparent', color: tab === k ? 'var(--ink-deep)' : 'var(--parchment-dim)' }}
              >
                {l}
                {k === 'tasks' && overdueCount > 0 ? (
                  <span className="font-mono text-[10px] px-1 rounded" style={{ background: 'var(--danger)', color: '#fff' }}>{overdueCount}</span>
                ) : n > 0 && k !== 'cal' ? (
                  <span className="font-mono text-[10px] opacity-80">{n}</span>
                ) : null}
              </button>
            ))}
          </div>

          {gc && gc.on && gc.needsAuth && (
            <button
              onClick={() => window.KoukaiGcal.syncNow()}
              className="relative mt-3 w-full text-xs py-2 rounded-lg flex items-center justify-center gap-1.5"
              style={{ color: 'var(--ink-deep)', background: 'var(--brass)' }}
            >
              📆 Googleカレンダーにつなぎ直す（押すと同期します）
            </button>
          )}

          {tab === 'cal' && (
          <div className="relative flex items-center justify-between mt-4">
            <button onClick={goPrevMonth} aria-label="前の月" className="p-1.5 rounded-md" style={{ color: 'var(--parchment-dim)', background: 'transparent' }}>
              <ChevronLeft size={18} />
            </button>
            <div className="font-display text-xl">{viewYear}年{viewMonth + 1}月</div>
            <button onClick={goNextMonth} aria-label="次の月" className="p-1.5 rounded-md" style={{ color: 'var(--parchment-dim)', background: 'transparent' }}>
              <ChevronRight size={18} />
            </button>
          </div>
          )}
        </div>

        {tab === 'tasks' && (
          <TaskPanel
            tasks={tasks}
            goals={goals}
            today={todayStr}
            onToggle={toggleTask}
            onEdit={(t) => setTaskEdit(t)}
            onQuickAdd={(title) => { saveTask({ ...emptyTask(todayStr), title }); showToast('タスクを足しました'); }}
          />
        )}
        {tab === 'plan' && (
          <PlanPanel goals={goals} tasks={tasks} today={todayStr} onEditGoal={(g) => setGoalEdit(g)} onToggle={toggleTask} onEditTask={(t) => setTaskEdit(t)} onAddSteps={addGoalSteps} />
        )}

        {tab === 'cal' && (<>

        <div className="grid grid-cols-7 px-3 pt-3 font-mono text-[11px]">
          {WEEKDAYS_JA.map((wd, i) => (
            <div
              key={wd}
              className="text-center pb-1.5"
              style={{ color: i === 0 ? 'var(--danger)' : i === 6 ? 'var(--signal)' : 'var(--parchment-dim)' }}
            >
              {wd}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-y-1 px-3 pb-3">
          {gridCells.map((cell) => {
            const dayEvents = eventsByDate[cell.key] || [];
            const isToday = cell.key === todayStr;
            const isSelected = cell.key === selectedKey;
            return (
              <button
                key={cell.key + (cell.currentMonth ? '-c' : '-o')}
                onClick={() => selectDay(cell.key)}
                className="day-cell relative flex flex-col items-center justify-start py-1.5 rounded-lg"
                style={{
                  opacity: cell.currentMonth ? 1 : 0.3,
                  backgroundColor: isSelected ? 'var(--ink-panel-2)' : 'transparent',
                  border: isSelected ? '1px solid var(--chart-line)' : '1px solid transparent',
                }}
              >
                <span
                  className="font-mono text-[13px] w-6 h-6 flex items-center justify-center rounded-full"
                  style={{
                    color: isToday ? 'var(--ink-deep)' : 'var(--parchment)',
                    backgroundColor: isToday ? 'var(--brass)' : 'transparent',
                    fontWeight: isToday ? 600 : 400,
                  }}
                >
                  {cell.day}
                </span>
                {dayEvents.some((e) => e.star) && (
                  <span className="absolute top-0.5 left-1 text-[9px] leading-none" style={{ color: 'var(--brass-bright)' }} aria-label="重要な予定あり">★</span>
                )}
                {diaryDoneCount(diary[cell.key]) > 0 && (
                  <span
                    className="absolute top-0.5 right-1 text-[9px] leading-none"
                    style={{ color: diaryDoneCount(diary[cell.key]) >= DIARY_SLOTS ? 'var(--brass-bright)' : 'var(--parchment-dim)' }}
                    aria-label="できた事日記あり"
                  >
                    ✦
                  </span>
                )}
                {(() => {
                  // 何日か続く予定は、日をまたいでつながる帯で出す（1つめだけ）
                  const m = dayEvents.find((e) => e.spanEnd && e.instanceDate && e.spanEnd > e.instanceDate);
                  if (!m) return null;
                  const first = cell.key === m.instanceDate, last = cell.key === m.spanEnd;
                  return (
                    <span
                      className="absolute bottom-0.5 h-1"
                      style={{
                        left: first ? '20%' : '-1px', right: last ? '20%' : '-1px',
                        background: 'var(--brass)', opacity: 0.75,
                        borderRadius: `${first ? 3 : 0}px ${last ? 3 : 0}px ${last ? 3 : 0}px ${first ? 3 : 0}px`,
                      }}
                      aria-hidden="true"
                    />
                  );
                })()}
                <span className="flex gap-0.5 h-1.5 mt-1">
                  {dayEvents.filter((e) => !(e.spanEnd && e.instanceDate && e.spanEnd > e.instanceDate)).slice(0, 3).map((ev) => (
                    <span key={ev.id} className="w-1 h-1 rounded-full" style={{ backgroundColor: 'var(--signal)' }} />
                  ))}
                  {(tasksByDue[cell.key] || []).some((t) => !t.done) && (
                    <span className="w-1 h-1" style={{ backgroundColor: cell.key < todayStr ? 'var(--danger)' : 'var(--brass-bright)' }} aria-label="期限のタスクあり" />
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {starList.length > 0 && (
          <div className="px-4 py-3" style={{ borderTop: '1px solid var(--chart-line)' }} aria-label="大事な予定">
            <h2 className="font-display text-sm mb-2 flex items-center gap-1.5">
              <span style={{ color: 'var(--brass-bright)' }}>★</span> 大事な予定
            </h2>
            <ul className="space-y-1">
              {starList.slice(0, 6).map((x) => {
                const left = starLeftText(x, todayStr);
                const soon = /今日|明日|期間中/.test(left) || (/^あと(\d+)日$/.test(left) && Number(left.match(/\d+/)[0]) <= 7);
                return (
                  <li key={x.id + x.d}>
                    <button onClick={() => openDay(x.d <= todayStr && x.e2 >= todayStr ? todayStr : x.d)} className="w-full flex items-center gap-2 text-left text-sm py-1" style={{ background: 'transparent', color: 'var(--parchment)' }}>
                      <span className="font-mono text-[11px] w-16 shrink-0" style={{ color: 'var(--parchment-dim)' }}>{formatMD(x.d)}</span>
                      <span className="flex-1 min-w-0 truncate">{x.i ? `${x.i} ` : ''}{x.n}{x.e2 ? <span className="text-[11px]" style={{ color: 'var(--parchment-dim)' }}>（〜{formatMD(x.e2)}）</span> : null}</span>
                      <span className="font-mono text-xs shrink-0 px-1.5 py-0.5 rounded" style={{ color: soon ? 'var(--ink-deep)' : 'var(--brass-bright)', background: soon ? 'var(--brass)' : 'transparent' }}>{left}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="px-4 pt-4 pb-4" style={{ borderTop: '1px solid var(--chart-line)', background: 'var(--ink-deep)' }}>
          <div className="flex items-center justify-between mb-3 gap-2">
            <h2 className="font-display text-base">{formatSelectedHeading(selectedKey)}</h2>
            <button
              onClick={() => openAddModal(selectedKey)}
              className="flex items-center gap-1 font-mono text-xs px-2.5 py-1.5 rounded-md shrink-0"
              style={{ color: 'var(--ink-deep)', backgroundColor: 'var(--brass)' }}
            >
              <Plus size={13} /> 予定を追加
            </button>
          </div>

          {!loaded ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--parchment-dim)' }}>読み込み中…</p>
          ) : selectedEvents.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--parchment-dim)' }}>この日の予定はまだありません</p>
          ) : (
            <ul className="space-y-2">
              {selectedEvents.map((ev) => (
                <li key={`${ev.masterId}-${ev.occurrenceDate}`} className="rounded-lg p-3" style={{ background: 'var(--ink-panel)', border: '1px solid var(--chart-line)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate flex items-center gap-1.5">
                        {ev.star && <span style={{ color: 'var(--brass-bright)' }} aria-label="重要">★</span>}
                        {TYPE_ICONS[ev.type] ? `${TYPE_ICONS[ev.type]} ` : ''}{ev.title}
                        {ev.isRecurring && <Repeat size={11} style={{ color: 'var(--brass-bright)' }} aria-label="繰り返し予定" />}
                      </p>
                      <p className="font-mono text-xs mt-0.5" style={{ color: 'var(--signal)' }}>
                        {ev.allDay ? '終日' : `${ev.startTime}–${ev.endTime}`}
                      </p>
                      {ev.spanEnd && ev.instanceDate && ev.spanEnd > ev.instanceDate && (
                        <p className="font-mono text-[11px] mt-0.5" style={{ color: 'var(--brass-bright)' }}>
                          {formatMD(ev.instanceDate)}〜{formatMD(ev.spanEnd)}・{eventSpanDays({ date: ev.instanceDate, end: ev.occurrenceDate }) + 1}日目／{eventSpanDays({ date: ev.instanceDate, end: ev.spanEnd }) + 1}日間
                        </p>
                      )}
                      {ev.isRecurring && (
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--parchment-dim)' }}>
                          {RECURRENCE_LABELS[ev.recurrence.freq]}
                          {ev.recurrence.interval > 1 ? `(${ev.recurrence.interval}${RECURRENCE_UNIT_LABELS[ev.recurrence.freq]}ごと)` : ''}
                        </p>
                      )}
                      {ev.readOnly && ev.source && (
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--brass-bright)' }}>
                          {ev.source.kind === 'kashikari' ? '💰 貸し借り帳（見るだけ）'
                            : ev.source.kind === 'gcal' ? <><span style={{ color: ev.source.color || 'inherit' }}>●</span> {ev.source.name}（Googleカレンダー{ev.gcal && ev.gcal.editable ? '・ここで直せます' : '・見るだけ'}）</>
                            : <>{ev.source.kind === 'group' ? '👪' : '🔗'} {ev.source.name}（すするanki・見るだけ）</>}
                        </p>
                      )}
                      {ev.location && (
                        <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--parchment-dim)' }}>
                          <MapPin size={11} /> {ev.location}
                        </p>
                      )}
                      {(ev.budget > 0 || ev.income > 0) && (
                        <p className="font-mono text-xs mt-1 flex flex-wrap gap-x-3" aria-label="お金">
                          {ev.budget > 0 && <span style={{ color: '#E08A84' }}>💰 予算 {yenOf(ev.budget)}</span>}
                          {ev.income > 0 && <span style={{ color: 'var(--signal)' }}>💴 入る {yenOf(ev.income)}</span>}
                        </p>
                      )}
                      {ev.notes && (
                        <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: 'var(--parchment-dim)' }}>{ev.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {ev.readOnly && (
                        <button onClick={() => copyToMine(ev)} aria-label="自分の予定にコピー" title="自分の予定にコピー" className="p-1.5 rounded-md" style={{ color: 'var(--parchment-dim)', background: 'transparent' }}>
                          <Plus size={14} />
                        </button>
                      )}
                      <button onClick={() => handleExportOne(ev)} aria-label="この予定を書き出す" className="p-1.5 rounded-md" style={{ color: 'var(--parchment-dim)', background: 'transparent' }}>
                        <Download size={14} />
                      </button>
                      {!ev.readOnly && (
                      <button onClick={() => openEditModal(ev)} aria-label="編集" className="p-1.5 rounded-md" style={{ color: 'var(--parchment-dim)', background: 'transparent' }}>
                        <Pencil size={14} />
                      </button>
                      )}
                      {ev.gcal && ev.gcal.editable && (
                        <>
                          <button onClick={() => openGcalEdit(ev)} aria-label="Googleの予定を直す" className="p-1.5 rounded-md" style={{ color: 'var(--parchment-dim)', background: 'transparent' }}>
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => deleteGcalEvent(ev)} aria-label="Googleの予定を消す" className="p-1.5 rounded-md" style={{ color: 'var(--parchment-dim)', background: 'transparent' }}>
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                      {ev.readOnly ? null : confirmDelete && confirmDelete.masterId === ev.masterId && confirmDelete.occurrenceDate === ev.occurrenceDate ? (
                        ev.isRecurring ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDeleteOccurrence(ev.masterId, ev.instanceDate || ev.occurrenceDate)}
                              className="font-mono text-[10px] px-1.5 py-1.5 rounded-md whitespace-nowrap"
                              style={{ color: '#fff', backgroundColor: 'var(--danger)' }}
                            >
                              この回のみ
                            </button>
                            <button
                              onClick={() => handleDeleteSeries(ev.masterId)}
                              className="font-mono text-[10px] px-1.5 py-1.5 rounded-md whitespace-nowrap"
                              style={{ color: '#fff', backgroundColor: 'var(--danger)' }}
                            >
                              すべて削除
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleDeleteSeries(ev.masterId)}
                            className="font-mono text-[10px] px-1.5 py-1.5 rounded-md whitespace-nowrap"
                            style={{ color: '#fff', backgroundColor: 'var(--danger)' }}
                          >
                            削除する
                          </button>
                        )
                      ) : (
                        <button
                          onClick={() => setConfirmDelete({ masterId: ev.masterId, occurrenceDate: ev.occurrenceDate })}
                          aria-label="削除"
                          className="p-1.5 rounded-md"
                          style={{ color: 'var(--parchment-dim)', background: 'transparent' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {(
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono" style={{ color: 'var(--parchment-dim)' }}>✅ この日が期限のタスク{selTasks.length ? `（${selTasks.filter((t) => !t.done).length}/${selTasks.length}）` : ''}</h3>
                <button onClick={() => setTaskEdit(emptyTask(selectedKey))} className="text-[11px] font-mono px-2 py-1 rounded-md flex items-center gap-1" style={{ color: 'var(--brass-bright)', border: '1px solid var(--chart-line)', background: 'transparent' }}>
                  <Plus size={11} /> タスク
                </button>
              </div>
              {selTasks.length > 0 && <ul>{selTasks.map((t) => <TaskRow key={t.id} t={t} today={todayStr} goals={goals} onToggle={toggleTask} onEdit={(x) => setTaskEdit(x)} compact />)}</ul>}
            </div>
          )}

          <section
            ref={diarySection}
            className="mt-4 rounded-xl p-3.5"
            style={{ background: 'var(--ink-panel)', border: '1px solid var(--chart-line)', scrollMarginTop: '12px' }}
            aria-label="できた事日記"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-base flex items-center gap-1.5">
                <span style={{ color: 'var(--brass-bright)' }}>✦</span>
                {selectedKey === todayStr ? '今日のできた事' : 'この日のできた事'}
              </h3>
              <div className="flex items-center gap-1.5 shrink-0">
                {diaryStreakDays > 0 && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--ink-deep)', background: 'var(--signal)' }}>
                    {diaryStreakDays}日連続
                  </span>
                )}
                <button
                  onClick={() => setReviewOpen(true)}
                  className="font-mono text-[11px] px-2 py-1 rounded-md"
                  style={{ color: 'var(--brass-bright)', border: '1px solid var(--chart-line)', background: 'transparent' }}
                >
                  振り返る
                </button>
              </div>
            </div>
            <p className="text-[11px] mt-1 mb-3" style={{ color: 'var(--parchment-dim)' }}>
              {isFutureDay ? 'まだ先の日です。その日になったら書けます。' : 'どんなに小さなことでも大丈夫。できた事を3つ書こう（もっとあれば「＋」で増やせます）。'}
            </p>

            <ol className="space-y-2">
              {selDiary.items.map((text, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span
                    className="w-5 h-5 shrink-0 rounded-full flex items-center justify-center font-mono text-[11px]"
                    style={{
                      background: text.trim() ? 'var(--brass)' : 'transparent',
                      color: text.trim() ? 'var(--ink-deep)' : 'var(--parchment-dim)',
                      border: '1px solid ' + (text.trim() ? 'var(--brass)' : 'var(--chart-line)'),
                    }}
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <input
                    ref={i === 0 ? diaryFirstInput : undefined}
                    type="text"
                    value={text}
                    disabled={isFutureDay}
                    maxLength={200}
                    onChange={(e) => {
                      const items = [...selDiary.items];
                      items[i] = e.target.value;
                      updateDiary(selectedKey, { items });
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                      const row = e.currentTarget.closest('section');
                      const inputs = row ? row.querySelectorAll('input') : [];
                      if (inputs[i + 1]) inputs[i + 1].focus(); else e.currentTarget.blur();
                    }}
                    placeholder={DIARY_PLACEHOLDERS[i] || '例：ほかにできた事'}
                    className="diary-input flex-1 min-w-0 px-3 py-2 rounded-lg text-sm"
                    aria-label={`できた事 ${i + 1}つ目`}
                  />
                  {i >= DIARY_SLOTS && !isFutureDay && (
                    <button
                      type="button"
                      onClick={() => updateDiary(selectedKey, { items: selDiary.items.filter((_, k) => k !== i) })}
                      className="shrink-0 p-1.5 rounded-md"
                      style={{ color: 'var(--parchment-dim)', background: 'transparent' }}
                      aria-label={`${i + 1}つ目の欄を消す`}
                    >
                      <X size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ol>
            {!isFutureDay && selDiary.items.length < DIARY_MAX && (
              <button
                type="button"
                onClick={() => {
                  updateDiary(selectedKey, { items: [...selDiary.items, ''] });
                  // 足した欄にすぐ書けるように
                  setTimeout(() => {
                    const ins = diarySection.current ? diarySection.current.querySelectorAll('ol input') : [];
                    if (ins.length) ins[ins.length - 1].focus();
                  }, 50);
                }}
                className="mt-2 w-full flex items-center justify-center gap-1 text-xs py-1.5 rounded-lg"
                style={{ color: 'var(--brass-bright)', border: '1px dashed var(--chart-line)', background: 'transparent' }}
              >
                <Plus size={13} /> もう1つ書く
              </button>
            )}

            <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: '1px dashed var(--chart-line)' }}>
              <span className="text-sm shrink-0" aria-hidden="true">📚</span>
              <label htmlFor="diary-anki" className="text-xs shrink-0" style={{ color: 'var(--parchment)' }}>
                すするankiで<br className="sm:hidden" />解いた数
              </label>
              <input
                id="diary-anki"
                type="number"
                inputMode="numeric"
                min={0}
                max={99999}
                value={selDiary.anki === null ? '' : selDiary.anki}
                disabled={isFutureDay}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Math.max(0, Math.min(99999, parseInt(e.target.value, 10) || 0));
                  updateDiary(selectedKey, { anki: v, ankiAuto: false });
                }}
                placeholder="0"
                className="diary-input w-20 ml-auto px-2 py-2 rounded-lg text-sm font-mono text-right"
              />
              <span className="text-xs shrink-0" style={{ color: 'var(--parchment-dim)' }}>問</span>
            </div>
            {!isFutureDay && (
              <div className="text-[11px] mt-1.5 pl-6 flex items-center justify-end gap-2 flex-wrap" style={{ color: 'var(--parchment-dim)' }}>
                {!loggedIn ? (
                  <button onClick={() => setSyncOpen(true)} className="underline" style={{ background: 'transparent', color: 'var(--parchment-dim)' }}>
                    ☁️ ログインすると、すするankiで解いた数が自動で入ります
                  </button>
                ) : !selAnkiLog ? (
                  <span>すするankiの記録を読んでいます…</span>
                ) : (
                  <>
                    <span>すするanki：解いた {selAnkiLog.answered}問（正解 {selAnkiLog.correct}問）</span>
                    {selDiary.anki === selAnkiLog.answered ? (
                      selDiary.ankiAuto !== false && <span style={{ color: 'var(--signal)' }}>（自動で入れています）</span>
                    ) : (
                      <button
                        onClick={() => updateDiary(selectedKey, { anki: selAnkiLog.answered, ankiAuto: true })}
                        className="px-2 py-0.5 rounded-md"
                        style={{ color: 'var(--ink-deep)', background: 'var(--brass)' }}
                      >
                        解いた数を入れる
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="flex items-center justify-between mt-2.5 text-[11px] font-mono" style={{ color: 'var(--parchment-dim)' }}>
              <span>
                {selDone >= DIARY_SLOTS ? (
                  <span style={{ color: 'var(--brass-bright)' }}>🎉 {selDone}つ書けました！よくがんばりました</span>
                ) : (
                  `${selDone} / ${DIARY_SLOTS} 書きました`
                )}
              </span>
              <span style={{ opacity: diarySaved ? 1 : 0, transition: 'opacity 0.3s' }} aria-live="polite">
                {diarySaved ? '✓ 保存しました' : ''}
              </span>
            </div>
          </section>

          <section className="mt-4 rounded-xl p-3.5" style={{ background: 'var(--ink-panel)', border: '1px solid var(--chart-line)' }} aria-label="日記">
            <h3 className="font-display text-base flex items-center gap-1.5 mb-2">📖 {selectedKey === todayStr ? '今日の日記' : 'この日の日記'}</h3>
            <textarea
              value={selDiary.note || ''}
              disabled={isFutureDay}
              onChange={(e) => updateDiary(selectedKey, { note: e.target.value })}
              rows={Math.min(14, Math.max(4, (selDiary.note || '').split('\n').length + 1))}
              maxLength={20000}
              placeholder={isFutureDay ? 'まだ先の日です' : 'その日のこと・思ったことを、自由に書けます（書くとすぐ保存・ほかの端末にも届きます）'}
              className="diary-input w-full px-3 py-2 rounded-lg text-sm leading-relaxed resize-y"
              aria-label="日記"
            />
            <div className="flex justify-between text-[11px] font-mono mt-1" style={{ color: 'var(--parchment-dim)' }}>
              <span>{(selDiary.note || '').length ? `${(selDiary.note || '').length}文字` : ''}</span>
              <span style={{ opacity: diarySaved ? 1 : 0, transition: 'opacity 0.3s' }}>{diarySaved ? '✓ 保存しました' : ''}</span>
            </div>
          </section>
        </div>
        </>)}

        <div className="px-4 pb-5">
          {tab === 'cal' && (<>
          <button
            onClick={handleExportAll}
            className="w-full flex items-center justify-center gap-2 font-mono text-xs py-2.5 rounded-lg"
            style={{ color: 'var(--brass-bright)', border: '1px solid var(--chart-line)', background: 'transparent' }}
          >
            <Download size={13} /> すべての予定を書き出す (.ics)
          </button>
          <p className="text-[11px] text-center mt-2 leading-relaxed" style={{ color: 'var(--parchment-dim)' }}>
            PCのGoogleカレンダーで「設定」→「インポート / エクスポート」から取り込めます(スマホアプリからは不可)
          </p>
          </>)}
          {koukaiAppOutdated() && koukaiApkAuto() ? (
            apk.silent ? (
              <p className="mt-3 text-[11px] text-center" style={{ color: 'var(--parchment-dim)' }}>📲 新しいアプリを用意しています。アプリを閉じると自動で更新されます</p>
            ) : (
              <button
                onClick={() => koukaiInstallApk()}
                className="mt-3 w-full flex items-center justify-center gap-2 font-mono text-xs py-2.5 rounded-lg"
                style={{ color: 'var(--ink-deep)', background: 'var(--brass)' }}
              >
                🆕 新しいアプリに更新する
              </button>
            )
          ) : koukaiAppOutdated() ? (
            <a
              href={ANDROID_APK_URL}
              className="mt-3 w-full flex items-center justify-center gap-2 font-mono text-xs py-2.5 rounded-lg"
              style={{ color: 'var(--ink-deep)', background: 'var(--brass)' }}
            >
              🆕 新しいアプリがあります（ダウンロードして入れ直す）
            </a>
          ) : !koukaiIsApp() && /Android/i.test(navigator.userAgent || '') ? (
            <a
              href={ANDROID_APK_URL}
              className="mt-3 w-full flex items-center justify-center gap-2 font-mono text-xs py-2.5 rounded-lg"
              style={{ color: 'var(--brass-bright)', border: '1px solid var(--chart-line)' }}
            >
              🤖 Android アプリ（ホーム画面のウィジェット付き）をダウンロード
            </a>
          ) : null}
        </div>
      </div>

      </div>

      {taskEdit && (
        <TaskEditor
          task={{ ...emptyTask(''), ...taskEdit }}
          goals={goals}
          today={todayStr}
          onSave={(t) => { saveTask(t); setTaskEdit(null); showToast('保存しました'); }}
          onDelete={deleteTask}
          onClose={() => setTaskEdit(null)}
        />
      )}
      {goalEdit && <GoalEditor goal={{ ...emptyGoal(), ...goalEdit }} onSave={saveGoal} onDelete={deleteGoal} onClose={() => setGoalEdit(null)} />}

      {modalOpen && (
        <div
          className="fixed inset-0 flex items-end sm:items-center justify-center z-50"
          style={{ background: 'rgba(8,12,16,0.6)' }}
          onClick={closeModal}
        >
          <div
            className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-y-auto"
            style={{ background: 'var(--parchment)', color: 'var(--ink-deep)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg">{form._gcal ? 'Googleの予定を直す' : form.id ? '予定を編集' : '予定を追加'}</h3>
              <button onClick={closeModal} aria-label="閉じる" className="p-1" style={{ background: 'transparent', color: 'var(--ink-deep)' }}>
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <label className="field block">
                <span className="text-xs font-medium block mb-1">タイトル</span>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  placeholder="会議、通院、誕生日会…"
                  autoFocus
                />
              </label>

              <div className="flex gap-2 items-end">
                <label className="field block flex-1">
                  <span className="text-xs font-medium block mb-1">{form.end ? 'はじめの日' : '日付'}</span>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => {
                      // はじめの日を動かしたら、何日続くかはそのままで最後の日も動かす
                      const d = e.target.value;
                      const len = form.end && form.end > form.date ? eventSpanDays({ date: form.date, end: form.end }) : 0;
                      setForm({ ...form, date: d, end: len && d ? addDaysToKey(d, len) : form.end });
                    }}
                    className="w-full px-3 py-2 rounded-lg text-sm font-mono"
                  />
                </label>
                {form.end ? (
                  <label className="field block flex-1">
                    <span className="text-xs font-medium block mb-1">最後の日</span>
                    <input
                      type="date"
                      value={form.end}
                      min={form.date}
                      onChange={(e) => setForm({ ...form, end: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg text-sm font-mono"
                    />
                  </label>
                ) : (
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, end: addDaysToKey(form.date, 1), allDay: true })}
                    className="shrink-0 text-xs px-3 py-2 rounded-lg"
                    style={{ border: '1px solid var(--chart-line)', background: '#fff', color: 'var(--ink-deep)' }}
                  >
                    ＋ 何日か続く
                  </button>
                )}
              </div>
              {form.end && (
                <div className="flex items-center justify-between -mt-1">
                  <p className="text-[11px]" style={{ color: '#5B6D7A' }}>
                    {form.end > form.date ? `${eventSpanDays({ date: form.date, end: form.end }) + 1}日間（${formatMD(form.date)}〜${formatMD(form.end)}）` : '最後の日を選んでください'}
                    {!form.allDay && '・時刻は毎日の時刻'}
                  </p>
                  <button type="button" onClick={() => setForm({ ...form, end: '' })} className="text-[11px] underline" style={{ background: 'transparent', color: '#5B6D7A' }}>
                    1日だけにする
                  </button>
                </div>
              )}

              {form._gcal && (
                <p className="text-[11px] leading-relaxed rounded-lg p-2" style={{ background: 'rgba(60,90,110,0.08)', border: '1px solid var(--chart-line)', color: '#3C4E5C' }}>
                  📆 Googleカレンダー「{form._gcal.calName}」の予定を直します（Google にすぐ書きます）。{form._gcal.recurring ? '繰り返しの予定は、この回だけ直します。' : ''}
                </p>
              )}
              {!form._gcal && (
              <button
                type="button"
                onClick={() => setForm({ ...form, star: !form.star })}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left"
                style={{ border: '1px solid ' + (form.star ? 'var(--brass)' : 'var(--chart-line)'), background: form.star ? 'rgba(201,161,92,0.18)' : '#fff', color: 'var(--ink-deep)' }}
                aria-pressed={form.star}
              >
                <span className="text-lg leading-none" style={{ color: form.star ? '#A9823F' : '#B8C2CA' }}>{form.star ? '★' : '☆'}</span>
                <span className="flex-1">
                  <span className="font-medium">重要な予定</span>
                  <span className="block text-[11px]" style={{ color: '#5B6D7A' }}>「★ 大事な予定」とウィジェットに、あと何日かを出します</span>
                </span>
              </button>
              )}

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.allDay}
                  onChange={(e) => setForm({ ...form, allDay: e.target.checked })}
                  style={{ accentColor: 'var(--brass)' }}
                />
                終日
              </label>

              {!form.allDay && (
                <div className="flex gap-2">
                  <label className="field block flex-1">
                    <span className="text-xs font-medium block mb-1">開始</span>
                    <input
                      type="time"
                      value={form.startTime}
                      onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg text-sm font-mono"
                    />
                  </label>
                  <label className="field block flex-1">
                    <span className="text-xs font-medium block mb-1">終了</span>
                    <input
                      type="time"
                      value={form.endTime}
                      onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg text-sm font-mono"
                    />
                  </label>
                </div>
              )}

              {!form._gcal && (<>
              <label className="field block">
                <span className="text-xs font-medium block mb-1">繰り返し</span>
                <select
                  value={form.recurrence.freq}
                  onChange={(e) => setForm({ ...form, recurrence: { ...form.recurrence, freq: e.target.value } })}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                >
                  <option value="none">{form.end ? '繰り返さない（この期間だけ）' : '繰り返さない'}</option>
                  <option value="daily">毎日</option>
                  <option value="weekly">毎週</option>
                  <option value="monthly">毎月</option>
                  <option value="yearly">毎年</option>
                </select>
              </label>

              {form.recurrence.freq !== 'none' && (
                <div className="rounded-lg p-3 space-y-3" style={{ background: 'rgba(60,90,110,0.08)', border: '1px solid var(--chart-line)' }}>
                  <label className="field flex items-center gap-2">
                    <span className="text-xs font-medium shrink-0">間隔</span>
                    <input
                      type="number"
                      min={1}
                      value={form.recurrence.interval}
                      onChange={(e) => setForm({ ...form, recurrence: { ...form.recurrence, interval: e.target.value } })}
                      className="w-16 px-2 py-1.5 rounded-lg text-sm font-mono"
                    />
                    <span className="text-xs">{RECURRENCE_UNIT_LABELS[form.recurrence.freq]}ごと</span>
                  </label>

                  {form.recurrence.freq === 'weekly' && (
                    <div>
                      <span className="text-xs font-medium block mb-1.5">曜日</span>
                      <div className="flex gap-1">
                        {WEEKDAYS_JA.map((wd, i) => {
                          const active = form.recurrence.daysOfWeek.includes(i);
                          return (
                            <button
                              key={wd}
                              type="button"
                              onClick={() => {
                                const days = active
                                  ? form.recurrence.daysOfWeek.filter((d) => d !== i)
                                  : [...form.recurrence.daysOfWeek, i];
                                setForm({ ...form, recurrence: { ...form.recurrence, daysOfWeek: days } });
                              }}
                              className="w-8 h-8 rounded-full text-xs font-mono"
                              style={{
                                color: active ? 'var(--ink-deep)' : 'var(--ink-deep)',
                                backgroundColor: active ? 'var(--brass)' : '#fff',
                                border: '1px solid var(--chart-line)',
                              }}
                            >
                              {wd}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[11px] mt-1" style={{ color: '#5B6D7A' }}>
                        未選択の場合、開始日の曜日が使われます
                      </p>
                    </div>
                  )}

                  <div>
                    <span className="text-xs font-medium block mb-1.5">終了条件</span>
                    <select
                      value={form.recurrence.endType}
                      onChange={(e) => setForm({ ...form, recurrence: { ...form.recurrence, endType: e.target.value } })}
                      className="w-full px-3 py-2 rounded-lg text-sm"
                    >
                      <option value="never">終了しない</option>
                      <option value="until">日付を指定</option>
                      <option value="count">回数を指定</option>
                    </select>
                  </div>

                  {form.recurrence.endType === 'until' && (
                    <label className="field block">
                      <span className="text-xs font-medium block mb-1">終了日</span>
                      <input
                        type="date"
                        value={form.recurrence.endDate}
                        min={form.date}
                        onChange={(e) => setForm({ ...form, recurrence: { ...form.recurrence, endDate: e.target.value } })}
                        className="w-full px-3 py-2 rounded-lg text-sm font-mono"
                      />
                    </label>
                  )}

                  {form.recurrence.endType === 'count' && (
                    <label className="field flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={form.recurrence.endCount}
                        onChange={(e) => setForm({ ...form, recurrence: { ...form.recurrence, endCount: e.target.value } })}
                        className="w-16 px-2 py-1.5 rounded-lg text-sm font-mono"
                      />
                      <span className="text-xs">回で終了</span>
                    </label>
                  )}

                  {form.end && form.end > form.date && (
                    <p className="text-[11px] leading-relaxed" style={{ color: '#5B6D7A' }}>
                      ※ 毎回{eventSpanDays({ date: form.date, end: form.end }) + 1}日間続きます（繰り返しの日が、その回のはじめの日）
                    </p>
                  )}
                  {form.id && (
                    <p className="text-[11px] leading-relaxed" style={{ color: '#5B6D7A' }}>
                      ※ 変更はこの繰り返し予定シリーズ全体に適用されます
                    </p>
                  )}
                </div>
              )}
              </>)}

              {!form._gcal && (<>
              <div className="grid grid-cols-2 gap-3">
                <label className="field block">
                  <span className="text-xs font-medium block mb-1">💰 かかりそうなお金（予算）</span>
                  <input type="text" inputMode="numeric" value={form.budget} placeholder="例：4000+2000"
                    onChange={(e) => setForm({ ...form, budget: e.target.value })} className="w-full px-3 py-2 rounded-lg text-sm font-mono" />
                </label>
                <label className="field block">
                  <span className="text-xs font-medium block mb-1">💴 入るお金（単発バイトなど）</span>
                  <input type="text" inputMode="numeric" value={form.income} placeholder="例：8000"
                    onChange={(e) => setForm({ ...form, income: e.target.value })} className="w-full px-3 py-2 rounded-lg text-sm font-mono" />
                </label>
              </div>
              {(moneyOf(form.budget) || moneyOf(form.income)) && (
                <p className="text-[11px] -mt-2" style={{ color: 'var(--parchment-dim)' }}>
                  {moneyOf(form.budget) ? `予算 ${yenOf(moneyOf(form.budget))}` : ''}{moneyOf(form.budget) && moneyOf(form.income) ? '・' : ''}{moneyOf(form.income) ? `入る ${yenOf(moneyOf(form.income))}` : ''}
                  {kl && kl.code ? '（貸し借り帳の見通しに入ります）' : '（「☁️」→「貸し借り帳と連携」すると、貸し借り帳の見通しに入ります）'}
                </p>
              )}
              </>)}

              <label className="field block">
                <span className="text-xs font-medium block mb-1">場所 (任意)</span>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                />
              </label>

              <label className="field block">
                <span className="text-xs font-medium block mb-1">メモ (任意)</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg text-sm resize-none"
                />
              </label>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={closeModal}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium"
                style={{ border: '1px solid var(--chart-line)', background: 'transparent', color: 'var(--ink-deep)' }}
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium"
                style={{ background: 'var(--ink-deep)', color: 'var(--parchment)' }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewOpen && (() => {
        const ym = `${viewYear}-${pad(viewMonth + 1)}`;
        const tot = diaryMonthTotals(diary, ym);
        const keys = Object.keys(diary).filter((k) => k.startsWith(ym) && diaryHasContent(diary[k])).sort().reverse();
        return (
          <div className="fixed inset-0 flex items-end sm:items-center justify-center z-50" style={{ background: 'rgba(8,12,16,0.6)' }} onClick={() => setReviewOpen(false)}>
            <div className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 max-h-[85vh] overflow-y-auto" style={{ background: 'var(--parchment)', color: 'var(--ink-deep)' }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-display text-lg">✦ {viewYear}年{viewMonth + 1}月のできた事</h3>
                <button onClick={() => setReviewOpen(false)} aria-label="閉じる" className="p-1" style={{ background: 'transparent', color: 'var(--ink-deep)' }}>
                  <X size={18} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                {[['書いた日', `${tot.days}日`], ['できた事', `${tot.done}個`], ['anki で解いた数', `${tot.anki}問`]].map(([label, val]) => (
                  <div key={label} className="rounded-lg py-2" style={{ background: 'rgba(60,90,110,0.1)', border: '1px solid var(--chart-line)' }}>
                    <div className="font-mono text-base font-semibold">{val}</div>
                    <div className="text-[10px]" style={{ color: '#5B6D7A' }}>{label}</div>
                  </div>
                ))}
              </div>
              {keys.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: '#5B6D7A' }}>この月の日記はまだありません。<br />カレンダーの月を変えると、ほかの月も見られます。</p>
              ) : (
                <ul className="space-y-3">
                  {keys.map((k) => {
                    const e = diary[k];
                    return (
                      <li key={k}>
                        <button
                          onClick={() => { setReviewOpen(false); openDiary(k); }}
                          className="w-full text-left rounded-lg p-3"
                          style={{ background: '#fff', border: '1px solid var(--chart-line)', color: 'var(--ink-deep)' }}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-display text-sm">{formatSelectedHeading(k)}</span>
                            {e.anki !== null && <span className="font-mono text-[11px]" style={{ color: '#5B6D7A' }}>📚 {e.anki}問</span>}
                          </div>
                          <ul className="text-xs space-y-0.5">
                            {e.items.filter((t) => t.trim()).map((t, i) => <li key={i}>・{t}</li>)}
                          </ul>
                          {e.note && e.note.trim() && <p className="text-xs mt-1.5 whitespace-pre-wrap line-clamp-4" style={{ color: '#3C4E5C' }}>📖 {e.note}</p>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        );
      })()}

      {syncOpen && (
        <div className="fixed inset-0 flex items-end sm:items-center justify-center z-50" style={{ background: 'rgba(8,12,16,0.6)' }} onClick={() => setSyncOpen(false)}>
          <div className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-y-auto" style={{ background: 'var(--parchment)', color: 'var(--ink-deep)' }} onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg mb-2">☁️ 同期（ほかの端末・すするanki）</h2>
            <p className="text-xs mb-3 leading-relaxed" style={{ opacity: 0.75 }}>
              ログインすると、<b>予定とできた事日記</b>が、同じアカウントでログインしたほかの端末（スマホ・パソコン・Android アプリ）に自動で届きます。どの端末で足した・直した・消したものも、ほかの端末に届きます（オフラインのときは、つながったら送ります）。
              すするanki のカレンダーとも同じ予定になります（すするanki でも、カレンダーの「🔗 連携」→「⚓ 航海日誌と同期」をオンに）。
            </p>
            {!sync || !sync.available ? (
              <p className="text-sm">同期の部品を読み込めませんでした（インターネットにつながっているか確かめてください）。</p>
            ) : !sync.user ? (
              <div className="space-y-2">
                <button onClick={() => runSync(() => window.VoyageSync.signInGoogle(), 'ログインしました')} className="w-full py-2.5 rounded-lg text-sm font-medium" style={{ background: 'var(--ink-deep)', color: 'var(--parchment)' }}>Google でログイン</button>
                {window.VoyageSync.canBrowserSignIn && window.VoyageSync.canBrowserSignIn() && (
                  <button onClick={() => runSync(() => window.VoyageSync.signInGoogleBrowser(), 'ログインしました')} className="w-full py-2 rounded-lg text-xs" style={{ border: '1px solid var(--chart-line)' }}>
                    うまくいかないとき：ブラウザでログイン（ログインしたら「アプリに戻る」）
                  </button>
                )}
                {loginErr && <p className="text-xs" style={{ color: 'var(--danger)' }}>⚠️ {loginErr}</p>}
                <p className="text-xs" style={{ opacity: 0.75 }}>どの端末でも、同じアカウント（すするanki で使っているもの）でログインしてください。メールアドレスを足してあれば、メールでも入れます。この端末にある予定・日記は、ログインするとアカウントに入って、ほかの端末に届きます。</p>
                <input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="メールアドレス" className="w-full px-3 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--chart-line)' }} />
                <input type="password" value={loginPw} onChange={(e) => setLoginPw(e.target.value)} placeholder="パスワード" className="w-full px-3 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--chart-line)' }} />
                <button onClick={() => runSync(() => window.VoyageSync.signInEmail(loginEmail.trim(), loginPw), 'ログインしました')} className="w-full py-2 rounded-lg text-sm" style={{ border: '1px solid var(--chart-line)' }}>メールでログイン</button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm">ログイン中：{sync.user.name}</p>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={sync.on} onChange={(e) => window.VoyageSync.setOn(e.target.checked)} />
                  予定とできた事日記を同期する
                </label>
                <p className="text-xs" style={{ opacity: 0.8 }}>
                  {!sync.on ? '同期していません（この端末の予定・日記は、この端末の中だけ）。'
                    : sync.error ? `⚠️ 同期できません（${sync.error}）`
                    : !sync.online ? '📴 オフラインです。変えた分はこの端末に覚えておき、つながったら送ります。'
                    : !sync.ready ? '⏳ つないでいます…'
                    : sync.pending ? '⏳ 送っています…'
                    : `✅ 同期しています（予定 ${sync.count}件・日記 ${sync.diaryDays}日）${sync.lastSyncAt ? `・${new Date(sync.lastSyncAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} に確認` : ''}`}
                </p>
                <label className="flex items-start gap-2 text-sm pt-2" style={{ borderTop: '1px solid var(--chart-line)' }}>
                  <input type="checkbox" className="mt-1" checked={sync.feedsOn} onChange={(e) => window.VoyageSync.setFeedsOn(e.target.checked)} />
                  <span>すするanki の「🔗 URL で購読したカレンダー」と「👪 グループの予定」も出す（見るだけ）</span>
                </label>
                {sync.feedsOn && (
                  <div className="text-xs space-y-0.5" style={{ opacity: 0.8 }}>
                    {sync.feedInfo.error ? <p>⚠️ 読めません（{sync.feedInfo.error}）</p> : null}
                    {sync.feedInfo.subs.map((x, i) => (
                      <p key={'s' + i}>🔗 {x.name}：{x.err && !x.n ? `⚠️ ${x.err}` : `${x.n}件`}{x.fetchedAt ? `（${new Date(x.fetchedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} にすするankiが読んだ分）` : ''}</p>
                    ))}
                    {sync.feedInfo.groups.map((x, i) => <p key={'g' + i}>👪 {x.name}：{x.n}件</p>)}
                    {!sync.feedInfo.subs.length && !sync.feedInfo.groups.length && !sync.feedInfo.error && <p>すするanki で購読しているカレンダー・グループはありません。</p>}
                    <p>直すときは、元のカレンダーやすするanki で直してください（ここには自動で届きます）。</p>
                  </div>
                )}
                <button onClick={() => runSync(() => window.VoyageSync.signOut(), 'ログアウトしました')} className="w-full py-2 rounded-lg text-sm" style={{ border: '1px solid var(--chart-line)' }}>ログアウト</button>
              </div>
            )}
            {gc && (
              <div className="space-y-2 pt-3 mt-3" style={{ borderTop: '1px solid var(--chart-line)' }} aria-label="Googleカレンダー">
                <p className="text-sm font-medium">📆 Googleカレンダーと同期</p>
                <p className="text-xs leading-relaxed" style={{ opacity: 0.8 }}>
                  航海日誌の予定を、Googleカレンダーの中の「航海日誌」カレンダーに自動で書きます（メインのカレンダーには書きません）。Google でその「航海日誌」カレンダーの予定を直す・足す・消すと、航海日誌にも届きます。
                  下で選んだカレンダー（家族と共有しているものも）の予定もここに出し、書きこめるカレンダーなら ✏️ で直せます。同期するのは、アプリ・ページを開いている間です。
                </p>
                {!gc.on ? (
                  <button onClick={() => window.KoukaiGcal.connect()} className="w-full py-2.5 rounded-lg text-sm font-semibold" style={{ background: 'var(--ink-deep)', color: 'var(--parchment)' }}>
                    Googleカレンダーとつなぐ
                  </button>
                ) : (
                  <>
                    <p className="text-xs">
                      {gc.busy ? '⏳ 同期しています…'
                        : gc.needsAuth ? '🔑 Google の許可が切れています。「つなぎ直す」を押してください'
                        : gc.error ? `⚠️ 同期できません（${gc.error}）`
                        : gc.lastSync ? `✅ 同期しています（Googleへ ${gc.pushed}件・Googleから ${gc.feedItems.length}件）・${new Date(gc.lastSync).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`
                        : '⏳ つないでいます…'}
                    </p>
                    {gc.fromGoogle > 0 && <p className="text-[11px]" style={{ opacity: 0.8 }}>↩️ Google で直された予定を {gc.fromGoogle}件 入れました</p>}
                    {gc.failed && gc.failed.length > 0 && (
                      <div className="text-[11px] rounded-lg p-2" style={{ color: 'var(--danger)', border: '1px solid var(--danger)' }}>
                        <p className="font-medium">⚠️ Google に送れなかった予定（{gc.failed.length}件）</p>
                        {gc.failed.slice(0, 5).map((f, i) => <p key={i}>・{f.title}{f.date ? `（${f.date}）` : ''}：{f.message}</p>)}
                        <p style={{ opacity: 0.8 }}>この文を教えてもらえれば直します。</p>
                      </div>
                    )}
                    {gc.calendars.length > 0 && (
                      <div className="rounded-lg p-2 space-y-1" style={{ background: 'rgba(60,90,110,0.08)', border: '1px solid var(--chart-line)' }}>
                        <p className="text-[11px] font-medium" style={{ opacity: 0.8 }}>ここに出すカレンダー</p>
                        {gc.calendars.filter((c) => c.id !== gc.calId).map((c) => {
                          const on = (gc.selected || []).includes(c.id);
                          return (
                            <label key={c.id} className="flex items-center gap-2 text-xs">
                              <input type="checkbox" checked={on} onChange={() => window.KoukaiGcal.setSelected(on ? gc.selected.filter((x) => x !== c.id) : [...(gc.selected || []), c.id])} />
                              <span style={{ color: c.color }}>●</span>
                              <span className="truncate">{c.name}{c.primary ? '（メイン）' : ''}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button onClick={() => window.KoukaiGcal.syncNow()} className="flex-1 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--brass)', color: 'var(--ink-deep)' }}>
                        {gc.needsAuth ? 'つなぎ直す' : '🔄 今すぐ同期'}
                      </button>
                      <button onClick={() => { window.KoukaiGcal.disconnect(); showToast('Googleカレンダーとの同期をやめました'); }} className="py-2 px-3 rounded-lg text-sm" style={{ border: '1px solid var(--chart-line)' }}>
                        やめる
                      </button>
                    </div>
                    <p className="text-[11px]" style={{ opacity: 0.7 }}>やめても Google の「航海日誌」カレンダーは残るので、いらなければ Googleカレンダーの設定から消してください。</p>
                  </>
                )}
              </div>
            )}
            <div className="space-y-2 pt-3 mt-3" style={{ borderTop: '1px solid var(--chart-line)' }}>
              <p className="text-sm font-medium">💰 貸し借り帳と連携</p>
              <p className="text-xs" style={{ opacity: 0.8 }}>貸し借り帳の定期の収入・支払い、返す期限、🎟 予定を、カレンダーに出します（見るだけ）。予定に付けた「予算」「入るお金」は、貸し借り帳の見通しに入り、お金が足りなくなりそうなら知らせます。</p>
              {kl && kl.code ? (
                <>
                  <p className="text-xs">
                    {kl.error ? `⚠️ ${kl.error}` : !kl.ready ? '⏳ つないでいます…' : `✅ 連携しています（貸し借り帳から ${kl.feed.length}件）${kl.feedAt ? `・${new Date(kl.feedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} の分` : ''}`}
                  </p>
                  <p className="text-[11px]" style={{ opacity: 0.7 }}>{sync && sync.user ? 'ログインしているので、航海日誌のほかの端末にも連携が届きます。' : 'ログインすると、航海日誌のほかの端末にも連携が届きます。'}</p>
                  <button onClick={() => { window.KashikariLink.clear(); showToast('貸し借り帳との連携をやめました'); }} className="w-full py-2 rounded-lg text-sm" style={{ border: '1px solid var(--chart-line)' }}>連携をやめる</button>
                </>
              ) : (
                <>
                  <p className="text-xs" style={{ opacity: 0.8 }}>貸し借り帳の「📒 自分の帳簿」→「⚙️ 設定」→「航海日誌と連携」の連携コード（またはリンク）を入れてください。</p>
                  <input type="text" value={klCode} onChange={(e) => setKlCode(e.target.value)} placeholder="連携コード" className="w-full px-3 py-2 rounded-lg text-sm font-mono" style={{ border: '1px solid var(--chart-line)', color: 'var(--ink-deep)' }} />
                  <button onClick={() => { if (window.KashikariLink && window.KashikariLink.setCode(klCode)) { setKlCode(''); showToast('💰 貸し借り帳と連携しました'); } else showToast('連携コードの形がちがいます', 'error'); }}
                    className="w-full py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--brass)', color: 'var(--ink-deep)' }}>連携する</button>
                </>
              )}
            </div>
            <button onClick={() => setSyncOpen(false)} className="w-full py-2 rounded-lg text-sm mt-3" style={{ border: '1px solid var(--chart-line)' }}>閉じる</button>
          </div>
        </div>
      )}

      {toast && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full font-mono text-xs shadow-lg z-50"
          style={{
            background: toast.type === 'error' ? 'var(--danger)' : 'var(--brass)',
            color: toast.type === 'error' ? '#fff' : 'var(--ink-deep)',
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
