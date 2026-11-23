// --- ✅ タスク・🧭 計画 の画面 ---
// 依存: planner.js, date-utils.js, calendar-grid.js (formatMD), icons.jsx
// データ（tasks・goals の一覧）と書きかえる関数は VoyageLog から受け取る（同期・アラーム・ウィジェットは VoyageLog が受け持つ）

// ---------- タスクの1行 ----------
function TaskRow({ t, today, goals, onToggle, onEdit, compact }) {
  const g = t.goalId ? goals.find((x) => x.id === t.goalId) : null;
  const grp = taskGroup(t, today);
  const dueColor = grp === 'overdue' ? 'var(--danger)' : grp === 'today' || grp === 'tomorrow' ? 'var(--brass-bright)' : 'var(--parchment-dim)';
  return (
    <li className="flex items-start gap-2.5 py-2" style={{ borderBottom: '1px solid rgba(60,90,110,0.35)' }}>
      <button
        onClick={() => onToggle(t)}
        className="mt-0.5 w-5 h-5 shrink-0 rounded-md flex items-center justify-center text-[12px]"
        style={{ border: '1.5px solid ' + (t.done ? 'var(--signal)' : 'var(--chart-line)'), background: t.done ? 'var(--signal)' : 'transparent', color: 'var(--ink-deep)' }}
        aria-label={t.done ? '未完了に戻す' : '完了にする'}
      >
        {t.done ? '✓' : ''}
      </button>
      <button onClick={() => onEdit(t)} className="flex-1 min-w-0 text-left" style={{ background: 'transparent', color: 'var(--parchment)' }}>
        <span className="block text-sm" style={{ textDecoration: t.done ? 'line-through' : 'none', opacity: t.done ? 0.5 : 1 }}>{t.title || '（名前なし）'}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-[11px] mt-0.5" style={{ color: 'var(--parchment-dim)' }}>
          {t.due && !compact && <span className="font-mono" style={{ color: t.done ? 'var(--parchment-dim)' : dueColor }}>{formatMD(t.due)} {t.done ? '' : taskDueText(t, today)}</span>}
          {t.due && compact && t.dueTime && <span className="font-mono">{t.dueTime}</span>}
          {t.alarm !== null && t.alarm !== undefined && !t.done && <span>🔔 {(ALARM_CHOICES.find(([v]) => v === Number(t.alarm)) || [0, ''])[1]}</span>}
          {g && <span>🧭 {g.title}</span>}
          {t.notes && <span className="truncate max-w-[12rem]">📝 {t.notes}</span>}
        </span>
      </button>
    </li>
  );
}

// ---------- タスクを足す・直す ----------
function TaskEditor({ task, goals, onSave, onDelete, onClose, today }) {
  const [f, setF] = React.useState(task);
  const isNew = !task.id;
  const save = () => {
    if (!f.title.trim()) return;
    onSave({ ...f, title: f.title.trim(), dueTime: f.due ? f.dueTime : '', alarm: f.due ? f.alarm : null });
  };
  return (
    <div className="fixed inset-0 flex items-end sm:items-center justify-center z-50" style={{ background: 'rgba(8,12,16,0.6)' }} onClick={onClose}>
      <div className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-y-auto" style={{ background: 'var(--parchment)', color: 'var(--ink-deep)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg">{isNew ? 'タスクを足す' : 'タスクを直す'}</h3>
          <button onClick={onClose} aria-label="閉じる" className="p-1" style={{ background: 'transparent', color: 'var(--ink-deep)' }}><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <label className="field block">
            <span className="text-xs font-medium block mb-1">やること</span>
            <input autoFocus type="text" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) save(); }} className="w-full px-3 py-2 rounded-lg text-sm" placeholder="例：数学のワーク p.20〜25" />
          </label>
          <div className="flex gap-2">
            <label className="field block flex-1">
              <span className="text-xs font-medium block mb-1">期限の日</span>
              <input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} className="w-full px-3 py-2 rounded-lg text-sm font-mono" />
            </label>
            <label className="field block w-28">
              <span className="text-xs font-medium block mb-1">時刻</span>
              <input type="time" value={f.dueTime} disabled={!f.due} onChange={(e) => setF({ ...f, dueTime: e.target.value })} className="w-full px-2 py-2 rounded-lg text-sm font-mono" />
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5 -mt-1">
            {[['今日', 0], ['明日', 1], ['1週間後', 7], ['なし', null]].map(([l, d]) => (
              <button key={l} type="button" onClick={() => setF({ ...f, due: d === null ? '' : addDaysToKey(today, d) })} className="text-[11px] px-2 py-1 rounded-md" style={{ border: '1px solid var(--chart-line)', background: '#fff' }}>{l}</button>
            ))}
          </div>
          <label className="field block">
            <span className="text-xs font-medium block mb-1">🔔 アラーム</span>
            <select value={f.alarm === null || f.alarm === undefined ? '' : String(f.alarm)} disabled={!f.due} onChange={(e) => setF({ ...f, alarm: e.target.value === '' ? null : Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg text-sm">
              {ALARM_CHOICES.map(([v, l]) => <option key={l} value={v === null ? '' : String(v)}>{l}</option>)}
            </select>
            <span className="text-[11px] block mt-1" style={{ color: '#5B6D7A' }}>
              {!f.due ? '期限の日を入れると、アラームを鳴らせます。' : !f.dueTime ? `時刻が無いときは ${ALARM_DEFAULT_TIME} を期限とみます。` : ''}
              {f.due && f.alarm !== null && f.alarm !== undefined ? ' Android アプリは閉じていても鳴ります（ブラウザは開いている間だけ）。' : ''}
            </span>
          </label>
          {goals.length > 0 && (
            <label className="field block">
              <span className="text-xs font-medium block mb-1">🧭 目標のステップにする</span>
              <select value={f.goalId || ''} onChange={(e) => setF({ ...f, goalId: e.target.value })} className="w-full px-3 py-2 rounded-lg text-sm">
                <option value="">しない</option>
                {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
            </label>
          )}
          <label className="field block">
            <span className="text-xs font-medium block mb-1">メモ (任意)</span>
            <textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} className="w-full px-3 py-2 rounded-lg text-sm resize-none" />
          </label>
        </div>
        <div className="flex gap-2 mt-5">
          {!isNew && (
            <button onClick={() => onDelete(f)} className="px-3 py-2.5 rounded-lg text-sm" style={{ color: '#fff', background: 'var(--danger)' }} aria-label="このタスクを消す"><Trash2 size={15} /></button>
          )}
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-medium" style={{ border: '1px solid var(--chart-line)', background: 'transparent', color: 'var(--ink-deep)' }}>キャンセル</button>
          <button onClick={save} disabled={!f.title.trim()} className="flex-1 py-2.5 rounded-lg text-sm font-medium" style={{ background: 'var(--ink-deep)', color: 'var(--parchment)', opacity: f.title.trim() ? 1 : 0.5 }}>保存</button>
        </div>
      </div>
    </div>
  );
}

// ---------- ✅ タスクの画面 ----------
function TaskPanel({ tasks, goals, today, onToggle, onEdit, onQuickAdd }) {
  const [quick, setQuick] = React.useState('');
  const [showDone, setShowDone] = React.useState(false);
  const groups = {};
  sortTasks(tasks).forEach((t) => { const g = taskGroup(t, today); (groups[g] = groups[g] || []).push(t); });
  const open = tasks.filter((t) => !t.done).length;
  const add = () => { if (!quick.trim()) return; onQuickAdd(quick.trim()); setQuick(''); };
  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-base">✅ タスク <span className="font-mono text-xs" style={{ color: 'var(--parchment-dim)' }}>のこり {open}</span></h2>
        <button onClick={() => onEdit(emptyTask(''))} className="flex items-center gap-1 font-mono text-xs px-2.5 py-1.5 rounded-md" style={{ color: 'var(--ink-deep)', backgroundColor: 'var(--brass)' }}>
          <Plus size={13} /> 期限・アラームつきで足す
        </button>
      </div>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }}
          placeholder="やることを書いて Enter（期限は今日）"
          className="diary-input flex-1 min-w-0 px-3 py-2 rounded-lg text-sm"
          aria-label="タスクをすぐ足す"
        />
        <button onClick={add} className="px-3 rounded-lg" style={{ color: 'var(--ink-deep)', background: 'var(--brass)' }} aria-label="足す"><Plus size={16} /></button>
      </div>
      {tasks.length === 0 && <p className="text-sm text-center py-6" style={{ color: 'var(--parchment-dim)' }}>タスクはまだありません。<br />上に書いて Enter で足せます。</p>}
      {TASK_GROUPS.map(([key, label]) => {
        const list = groups[key];
        if (!list || !list.length) return null;
        if (key === 'done') {
          return (
            <div key={key} className="mt-3">
              <button onClick={() => setShowDone(!showDone)} className="text-xs font-mono" style={{ background: 'transparent', color: 'var(--parchment-dim)' }}>
                {showDone ? '▾' : '▸'} {label}（{list.length}）
              </button>
              {showDone && <ul>{list.slice(0, 50).map((t) => <TaskRow key={t.id} t={t} today={today} goals={goals} onToggle={onToggle} onEdit={onEdit} />)}</ul>}
            </div>
          );
        }
        return (
          <div key={key} className="mb-3">
            <h3 className="text-xs font-mono mb-0.5" style={{ color: key === 'overdue' ? 'var(--danger)' : key === 'today' ? 'var(--brass-bright)' : 'var(--parchment-dim)' }}>{label}（{list.length}）</h3>
            <ul>{list.map((t) => <TaskRow key={t.id} t={t} today={today} goals={goals} onToggle={onToggle} onEdit={onEdit} />)}</ul>
          </div>
        );
      })}
    </div>
  );
}

// ---------- 目標を作る・直す ----------
function GoalEditor({ goal, onSave, onDelete, onClose }) {
  const [f, setF] = React.useState(goal);
  const isNew = !goal.id;
  const ok = f.title.trim() && f.end && f.start && f.end > f.start;
  return (
    <div className="fixed inset-0 flex items-end sm:items-center justify-center z-50" style={{ background: 'rgba(8,12,16,0.6)' }} onClick={onClose}>
      <div className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-y-auto" style={{ background: 'var(--parchment)', color: 'var(--ink-deep)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg">{isNew ? '🧭 目標を立てる' : '🧭 目標を直す'}</h3>
          <button onClick={onClose} aria-label="閉じる" className="p-1" style={{ background: 'transparent', color: 'var(--ink-deep)' }}><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <label className="field block">
            <span className="text-xs font-medium block mb-1">目標</span>
            <input autoFocus type="text" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="w-full px-3 py-2 rounded-lg text-sm" placeholder="例：英検2級に合格する" />
          </label>
          <div className="flex gap-2">
            <label className="field block flex-1">
              <span className="text-xs font-medium block mb-1">はじめる日</span>
              <input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} className="w-full px-3 py-2 rounded-lg text-sm font-mono" />
            </label>
            <label className="field block flex-1">
              <span className="text-xs font-medium block mb-1">期限</span>
              <input type="date" value={f.end} min={f.start} onChange={(e) => setF({ ...f, end: e.target.value })} className="w-full px-3 py-2 rounded-lg text-sm font-mono" />
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5 -mt-1">
            {[['3か月', 90], ['半年', 182], ['1年', 365], ['3年', 1095]].map(([l, d]) => (
              <button key={l} type="button" onClick={() => setF({ ...f, end: addDaysToKey(f.start || todayKey(), d) })} className="text-[11px] px-2 py-1 rounded-md" style={{ border: '1px solid var(--chart-line)', background: '#fff' }}>{l}</button>
            ))}
          </div>
          <label className="field block">
            <span className="text-xs font-medium block mb-1">なぜやるか・メモ (任意)</span>
            <textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={3} className="w-full px-3 py-2 rounded-lg text-sm resize-none" placeholder="やる気が落ちたときに読み返せるように" />
          </label>
          {f.end && f.start && f.end <= f.start && <p className="text-xs" style={{ color: 'var(--danger)' }}>期限は、はじめる日より後にしてください。</p>}
        </div>
        <div className="flex gap-2 mt-5">
          {!isNew && <button onClick={() => onDelete(f)} className="px-3 py-2.5 rounded-lg text-sm" style={{ color: '#fff', background: 'var(--danger)' }} aria-label="この目標を消す"><Trash2 size={15} /></button>}
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-medium" style={{ border: '1px solid var(--chart-line)', background: 'transparent', color: 'var(--ink-deep)' }}>キャンセル</button>
          <button onClick={() => ok && onSave({ ...f, title: f.title.trim() })} disabled={!ok} className="flex-1 py-2.5 rounded-lg text-sm font-medium" style={{ background: 'var(--ink-deep)', color: 'var(--parchment)', opacity: ok ? 1 : 0.5 }}>保存</button>
        </div>
      </div>
    </div>
  );
}

// ---------- 目標の1枚 ----------
function GoalCard({ goal, tasks, today, onEditGoal, onToggle, onEditTask, onAddSteps }) {
  const p = goalProgress(goal, tasks, today);
  const [open, setOpen] = React.useState(true);
  const [newStep, setNewStep] = React.useState('');
  const [splitOpen, setSplitOpen] = React.useState(false);
  const [mode, setMode] = React.useState('monthly');
  const [count, setCount] = React.useState(4);
  const steps = sortTasks(p.steps);
  const preview = splitOpen ? splitCheckpoints(goal.start, goal.end, mode, count) : [];
  const addStep = () => {
    if (!newStep.trim()) return;
    onAddSteps([{ title: newStep.trim(), due: '' }]); setNewStep('');
  };
  return (
    <div className="rounded-xl p-3.5 mb-3" style={{ background: 'var(--ink-panel)', border: '1px solid var(--chart-line)' }}>
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => setOpen(!open)} className="flex-1 min-w-0 text-left" style={{ background: 'transparent', color: 'var(--parchment)' }}>
          <span className="block font-display text-base">🧭 {goal.title}</span>
          <span className="block text-[11px] font-mono mt-0.5" style={{ color: 'var(--parchment-dim)' }}>
            {formatMD(goal.start)}〜{formatMD(goal.end)}・<span style={{ color: p.left <= 7 && p.left >= 0 ? 'var(--brass-bright)' : 'inherit' }}>{p.left >= 0 ? leftLabel(p.left) : `期限を${-p.left}日過ぎ`}</span>
          </span>
        </button>
        <button onClick={() => onEditGoal(goal)} aria-label="目標を直す" className="p-1.5 rounded-md shrink-0" style={{ color: 'var(--parchment-dim)', background: 'transparent' }}><Pencil size={14} /></button>
      </div>
      {/* 進み具合：ステップ（金）と、時間の過ぎた割合（細い線） */}
      <div className="mt-2.5">
        <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--ink-deep)' }}>
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.round(p.ratio * 100)}%`, background: 'var(--brass)' }} />
          <div className="absolute inset-y-0 w-0.5" style={{ left: `${Math.round(p.elapsed * 100)}%`, background: 'var(--parchment)' }} title="今日" />
        </div>
        <div className="flex justify-between text-[11px] font-mono mt-1" style={{ color: 'var(--parchment-dim)' }}>
          <span>ステップ {p.done}/{p.total}（{Math.round(p.ratio * 100)}%）・時間 {Math.round(p.elapsed * 100)}%</span>
          <span style={{ color: p.pace === 'behind' ? 'var(--danger)' : 'var(--signal)' }}>{PACE_LABELS[p.pace] || 'ステップを足そう'}</span>
        </div>
      </div>
      {goal.notes && open && <p className="text-xs mt-2 whitespace-pre-wrap" style={{ color: 'var(--parchment-dim)' }}>💭 {goal.notes}</p>}
      {open && (
        <>
          {steps.length > 0 && <ul className="mt-2">{steps.map((t) => <TaskRow key={t.id} t={t} today={today} goals={[]} onToggle={onToggle} onEdit={onEditTask} />)}</ul>}
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={newStep}
              onChange={(e) => setNewStep(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) addStep(); }}
              placeholder="ステップを足す（例：単語帳を1周）"
              className="diary-input flex-1 min-w-0 px-3 py-1.5 rounded-lg text-sm"
            />
            <button onClick={addStep} className="px-2.5 rounded-lg" style={{ color: 'var(--ink-deep)', background: 'var(--brass)' }} aria-label="ステップを足す"><Plus size={15} /></button>
          </div>
          <button onClick={() => setSplitOpen(!splitOpen)} className="mt-2 text-xs underline" style={{ background: 'transparent', color: 'var(--brass-bright)' }}>
            📐 逆算して区切る（期限までのチェックポイントを作る）
          </button>
          {splitOpen && (
            <div className="mt-2 rounded-lg p-2.5 text-xs" style={{ background: 'var(--ink-deep)', border: '1px solid var(--chart-line)' }}>
              <div className="flex flex-wrap items-center gap-2">
                {[['monthly', '毎月'], ['weekly', '毎週'], ['count', '回数で']].map(([v, l]) => (
                  <label key={v} className="flex items-center gap-1"><input type="radio" checked={mode === v} onChange={() => setMode(v)} />{l}</label>
                ))}
                {mode === 'count' && <input type="number" min={1} max={52} value={count} onChange={(e) => setCount(e.target.value)} className="diary-input w-14 px-1.5 py-0.5 rounded font-mono" aria-label="いくつに分けるか" />}
              </div>
              <p className="mt-1.5" style={{ color: 'var(--parchment-dim)' }}>
                {preview.length}個：{preview.slice(0, 8).map(formatMD).join('・')}{preview.length > 8 ? ' …' : ''}
              </p>
              <button
                onClick={() => { onAddSteps(preview.map((d, i) => ({ title: i === preview.length - 1 ? `${goal.title}（ゴール）` : `チェックポイント ${i + 1}`, due: d }))); setSplitOpen(false); }}
                className="mt-2 px-3 py-1.5 rounded-md"
                style={{ color: 'var(--ink-deep)', background: 'var(--brass)' }}
              >
                この{preview.length}個をステップにする
              </button>
              <p className="mt-1" style={{ color: 'var(--parchment-dim)' }}>あとで名前を押して、やることに書きかえてください（例：「長文を毎日1題」）。</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------- 道のり（ロードマップ）：目標ごとの帯を、月の目盛りの上に ----------
function Roadmap({ goals, tasks, today }) {
  if (!goals.length) return null;
  const from0 = [today, ...goals.map((g) => g.start)].sort()[0];
  const to0 = [today, ...goals.map((g) => g.end)].sort().slice(-1)[0];
  const a = parseDateKey(from0);
  const from = dateKey(a.year, a.month, 1);
  const to = to0;
  const total = Math.max(1, daysFromTo(from, to) + 1);
  const pos = (d) => `${Math.min(100, Math.max(0, (daysFromTo(from, d) / total) * 100))}%`;
  const months = [];
  for (let y = a.year, m = a.month, g = 0; g < 60; g++) {
    const k = dateKey(y, m, 1);
    if (k > to) break;
    months.push({ k, label: m === 0 || g === 0 ? `${y}/${m + 1}` : `${m + 1}月` });
    m += 1; if (m > 11) { m = 0; y += 1; }
  }
  const step = Math.ceil(months.length / 8);
  return (
    <div className="rounded-xl p-3 mb-4" style={{ background: 'var(--ink-deep)', border: '1px solid var(--chart-line)' }} aria-label="道のり">
      <h3 className="text-xs font-mono mb-2" style={{ color: 'var(--parchment-dim)' }}>🗺️ 道のり</h3>
      <div className="relative h-4 mb-1">
        {months.filter((_, i) => i % step === 0).map((m) => (
          <span key={m.k} className="absolute text-[9px] font-mono -translate-x-1/2" style={{ left: pos(m.k), color: 'var(--parchment-dim)' }}>{m.label}</span>
        ))}
      </div>
      <div className="relative">
        <div className="absolute top-0 bottom-0 w-px z-10" style={{ left: pos(today), background: 'var(--danger)' }} title="今日" />
        {goals.map((g) => {
          const p = goalProgress(g, tasks, today);
          return (
            <div key={g.id} className="relative h-7 mb-1">
              <div className="absolute top-1 h-5 rounded-md overflow-hidden" style={{ left: pos(g.start), right: `calc(100% - ${pos(g.end)})`, background: 'var(--ink-panel-2)', border: '1px solid var(--chart-line)', minWidth: '6px' }}>
                <div className="h-full" style={{ width: `${Math.round(p.ratio * 100)}%`, background: 'rgba(201,161,92,0.55)' }} />
                <span className="absolute inset-0 px-1.5 text-[10px] leading-5 truncate" style={{ color: 'var(--parchment)' }}>{g.title}</span>
              </div>
              {p.steps.filter((t) => t.due).map((t) => (
                <span key={t.id} className="absolute top-0 w-1.5 h-1.5 rounded-full -translate-x-1/2" style={{ left: pos(t.due), background: t.done ? 'var(--signal)' : 'var(--brass-bright)' }} title={`${formatMD(t.due)} ${t.title}`} />
              ))}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] mt-1" style={{ color: 'var(--parchment-dim)' }}>赤い線が今日・上の点がステップの期限（緑は済み）</p>
    </div>
  );
}

// ---------- 🧭 計画の画面 ----------
function PlanPanel({ goals, tasks, today, onEditGoal, onToggle, onEditTask, onAddSteps }) {
  const live = goals.slice().sort((a, b) => a.end.localeCompare(b.end));
  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-base">🧭 長期の計画</h2>
        <button onClick={() => onEditGoal(emptyGoal())} className="flex items-center gap-1 font-mono text-xs px-2.5 py-1.5 rounded-md" style={{ color: 'var(--ink-deep)', backgroundColor: 'var(--brass)' }}>
          <Plus size={13} /> 目標を立てる
        </button>
      </div>
      {live.length === 0 ? (
        <div className="text-sm py-6 px-2 leading-relaxed" style={{ color: 'var(--parchment-dim)' }}>
          <p className="mb-2">半年後・1年後に「こうなっていたい」目標を立てて、そこまでのステップ（中間の区切り）に分けておく場所です。</p>
          <p>① 目標と期限を決める → ② 「逆算して区切る」で毎月・毎週のチェックポイントを作る → ③ それぞれを、やることに書きかえる。ステップはタスクの一覧にも出て、アラームも付けられます。</p>
        </div>
      ) : (
        <>
          <Roadmap goals={live} tasks={tasks} today={today} />
          {live.map((g) => (
            <GoalCard key={g.id} goal={g} tasks={tasks} today={today} onEditGoal={onEditGoal} onToggle={onToggle} onEditTask={onEditTask} onAddSteps={(steps) => onAddSteps(g, steps)} />
          ))}
        </>
      )}
    </div>
  );
}
