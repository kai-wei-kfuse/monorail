import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { fitMiniWindow, miniWindowSizes } from '../platform/miniWindow';
import { miniUnresponsive, miniWindowBus } from '../platform/windowBus';
import type { MiniCommand, MiniOutcome, MiniSnapshot, MiniWindowBus } from '../platform/windowBus';
import { formatReadout } from '../shared/duration';
import { parseEntryText } from '../shared/tags';
import { InlineInput } from '../ui/controls/InlineInput';
import { cardProgress } from '../widgets/cardProgress';
import { HitNote, TimeField } from '../pages/home/TimeField';
import type { ReadoutNote, ReadoutOutcome, ReadoutRequest } from '../pages/home/TimeField';
import { Suggest } from '../pages/home/Suggest';
import { MiniWindow } from './shell/MiniWindow';
import { RELOADED_MESSAGE, epochGuard, isNewSession } from './miniSession';

type Send = (command: Record<string, unknown> & { type: MiniCommand['type'] }, at?: string) => Promise<MiniOutcome>;
const REPLY_TIMEOUT_MS = 5000;
/** 写名字：rename = 改正在计的那一条（不出自动完成）；否则是写新事件，project 是先选的分类（0.3.0-beta.4 D1）。 */
interface Edit { startedHere: boolean; snap: MiniSnapshot; draft: string; rename: boolean; project: string }
const keep = (e: MouseEvent) => e.preventDefault();   // 按下不抢输入框的焦点

/** 分类下拉：贴着小窗、与窗口同宽（0.3.0-beta.4 D1）。小窗里不新建分类。 */
function CatList({ projects, value, onPick }: { projects: MiniSnapshot['projects']; value: string; onPick: (name: string) => void }) {
  return <ul className="sel-pop combo-pop mini-cat-list" role="listbox" aria-label="分类">
    {projects.map(p => <li key={p.name} role="option" aria-selected={p.name === value} className={p.name === value ? 'on' : undefined}
      onMouseDown={e => { keep(e); onPick(p.name); }}><i className="combo-dot" style={{ background: p.color }} />{p.name}</li>)}
  </ul>;
}

/**
 * 小窗入口（架构 §5.5，N6 接线草案 evidence/n6-contracts.md）：只接收主窗口发来的快照，只发命令；不读写数据目录，不建 Ctx。
 * 先注册快照和回复，再告诉主窗口准备好了。每条命令带上打开编辑时那份快照的 entryId / cardId；回复按 requestId 对上。
 * 超过 3 秒没收到快照，说明那一条写「主窗口未响应」。窗口宽高跟着内容走（支持普通小窗口与 mini 窗口切换）。
 * 0.3.0-beta.4 D1：两种窗口都能选分类；写新事件时弹出和主窗口一样的自动完成；弹层由 Rust 按屏幕剩余空间决定往下还是往上。
 */
export function MiniApp({ bus = miniWindowBus, onClose = () => getCurrentWindow().hide() }: { bus?: MiniWindowBus; onClose?: () => Promise<void> }) {
  const [snap, setSnap] = useState<MiniSnapshot | null>(null), latest = useRef<MiniSnapshot | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null), mountedAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  const [edit, setEdit] = useState<Edit | null>(null);
  const [catOpen, setCatOpen] = useState(false), [popFit, setPopFit] = useState<{ up: boolean; max: number } | null>(null);
  const [note, setNote] = useState<ReadoutNote | null>(null), [error, setError] = useState<string | null>(null);
  const waiting = useRef(new Map<string, (outcome: MiniOutcome) => void>()), root = useRef<HTMLDivElement>(null);
  // 选中了自动完成里的一项：输入框随后卸载或失焦时不再按「写盘」处理
  const chosen = useRef(false);
  // 主窗口会话世代（D4）：更大的世代到了就清掉旧会话的编辑、提示、报错和等待中的回复；异步回调回来时核对世代
  const epoch = useRef<number | null>(null), guard = useRef(epochGuard(() => epoch.current ?? -1)).current;

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let alive = true;
    const onSnapshot = (s: MiniSnapshot) => {
      const previous = epoch.current;
      epoch.current = s.epoch;
      if (isNewSession(previous, s.epoch)) {
        setEdit(null); setCatOpen(false); setNote(null); setError(null);
        const pending = [...waiting.current.values()]; waiting.current.clear();
        pending.forEach(resolve => resolve({ kind: 'error', message: RELOADED_MESSAGE }));
      }
      latest.current = s; setSnap(s); setLastAt(Date.now()); document.documentElement.style.setProperty('--yellow', s.accent);
    };
    const offs = Promise.all([
      bus.onSnapshot(onSnapshot),
      bus.onReply(r => { waiting.current.get(r.requestId)?.(r.outcome); waiting.current.delete(r.requestId); }),
    ]).then(async fns => { if (alive) await bus.ready(); return fns; });
    return () => { alive = false; void offs.then(fns => fns.forEach(f => f())); };
  }, [bus]);

  // 分类下拉开着时：点小窗以外的地方或按 Esc 收起（写名字时 Esc 由输入框处理，同时放弃这次编辑）
  useEffect(() => {
    if (!catOpen) return;
    const away = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.('.mini-pop, .mini-cat, .mini-pick')) setCatOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setCatOpen(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [catOpen]);

  const hasSnap = !!snap, mode = snap?.miniMode ?? 'mini';
  const stale = miniUnresponsive(lastAt, mountedAt.current, now);
  const writingNew = !!edit && !edit.rename;
  const popKind: 'cat' | 'suggest' | null = catOpen ? 'cat' : writingNew ? 'suggest' : null;
  const prevMode = useRef<'mini' | 'tiny' | null>(null), targetW = useRef<number>(miniWindowSizes.mini.width), inFlight = useRef(false);
  const lastFit = useRef('');
  // 窗口宽高所有权：仅在模式实际切换（mini <-> tiny）时重置为默认宽度，首份快照及平时保留用户当前宽度；
  // 高度 = 本体（含说明）+ 弹层；弹层的方向和可用高度由 Rust 按屏幕工作区决定（fit_mini_window）
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !hasSnap || !('__TAURI_INTERNALS__' in window)) return;
    const bounds = miniWindowSizes[mode];
    const firstRun = prevMode.current === null;
    const modeChanged = !firstRun && prevMode.current !== mode;
    prevMode.current = mode;
    if (modeChanged) targetW.current = bounds.width;
    const fit = (forceWidth: boolean, forceApply: boolean) => {
      const curW = Math.round(window.innerWidth);
      if (!forceWidth && !inFlight.current && curW > 0) targetW.current = Math.max(bounds.minWidth, Math.min(curW, bounds.maxWidth));
      const pop = el.querySelector<HTMLElement>('.mini-pop');
      const total = el.getBoundingClientRect().height, shown = pop ? pop.getBoundingClientRect().height : 0;
      const bar = Math.ceil(total - shown) || bounds.height;
      const want = pop ? Math.ceil(pop.scrollHeight + 2) : 0;   // + 上下 1px 边框
      const w = targetW.current, key = `${mode}:${w}:${bar}:${want}`;
      if (!forceApply && !forceWidth && key === lastFit.current) return;
      lastFit.current = key; inFlight.current = true;
      void fitMiniWindow(mode, w, bar, want)
        .then(r => setPopFit(f => want === 0 ? null : f && f.up === r.up && f.max === r.popup ? f : { up: r.up, max: r.popup }))
        .catch(e => setError(`小窗没能调整尺寸：${String(e)}`))
        .finally(() => { inFlight.current = false; });
    };
    fit(modeChanged, firstRun || modeChanged);
    const ro = new ResizeObserver(() => fit(false, false));
    ro.observe(el);
    // 弹层里的列表被 max-height 截住时，它自己的高度变了外框不一定变：直接看列表
    const inner = el.querySelector('.mini-pop > *');
    if (inner) ro.observe(inner);
    return () => ro.disconnect();
  }, [hasSnap, mode, stale, error, note, popKind]);

  const base = edit?.snap ?? snap;
  const send: Send = (command, at = new Date().toISOString()) => new Promise(resolve => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { waiting.current.delete(requestId); resolve({ kind: 'error', message: '主窗口未响应' }); }, REPLY_TIMEOUT_MS);
    waiting.current.set(requestId, outcome => { clearTimeout(timer); resolve(outcome); });
    // epoch 取编辑开始时那份快照的，不取最新的：旧编辑不会被盖上新会话的世代变成合法命令
    void bus.send({ requestId, at, entryId: base?.entryId ?? null, cardId: base?.cardId ?? null, epoch: base?.epoch ?? 0, ...command } as MiniCommand)
      .catch(e => { waiting.current.delete(requestId); clearTimeout(timer); resolve({ kind: 'error', message: String(e) }); });
  });
  const act = (command: Parameters<Send>[0]) => {
    const started = epoch.current ?? -1;
    void send(command).then(guard.bind(started, (o: MiniOutcome) => setError(o.kind === 'error' ? o.message : null)));
  };

  if (!snap) return <div ref={root} className="mini-stack"><span className="mini-cap">{miniUnresponsive(lastAt, mountedAt.current, now) ? '主窗口未响应' : '等主窗口发来当前状态…'}</span></div>;

  const { entry, pending, card, resumeDescription } = snap;
  const running = entry && entry.project !== '待机' ? entry : null, away = running?.kind === '插入';
  // 显示的是哪张卡：正在计的卡，或者待确认时抽到还没开始的卡
  const c = card && (running?.cardId === card.id || (pending && card.status === '待做')) ? card : null;
  const pend = pending ? now - Date.parse(pending.startedAt) : 0;
  const total = c ? snap.closedEffectiveMs + (snap.currentSegStartedAt ? now - Date.parse(snap.currentSegStartedAt) : 0) + (c.status === '待做' ? pend : 0)
    : pending ? pend : entry ? now - Date.parse(entry.startedAt) : 0;
  const progress = cardProgress(total, c?.goalMinutes ?? null, !!running, away);
  const title = c ? c.content : pending ? '待确认' : running ? running.description : resumeDescription ? `已暂停：${resumeDescription}` : '待机';
  const currentProject = c?.project ?? running?.project ?? '未分类';
  // 分类：写新事件时是先选的那个；否则是正在计的这一条（是卡时改的是卡）。待机且不在写时没有
  const catValue = writingNew ? edit!.project : c || running ? currentProject : null;
  const color = (name: string) => snap.projects.find(p => p.name === name)?.color ?? 'var(--mute-2)';
  const pickProject = (project: string) => {
    setCatOpen(false);
    if (writingNew) { setEdit({ ...edit!, project }); return; }
    const s = latest.current ?? snap;
    if (c) act({ type: 'editCard', revision: s.revision, cardId: c.id, content: c.content, project });
    else if (running) act({ type: 'editOpen', revision: s.revision, pending_id: s.pending_id, patch: { project } });
  };
  const toggleCat = (e: MouseEvent) => { keep(e); setCatOpen(o => !o); };
  const meta = catValue !== null
    ? <>记到 <button type="button" className="mini-pick" id="mini-project" aria-haspopup="listbox" aria-expanded={catOpen} title={`分类：${catValue}`}
      onMouseDown={toggleCat}><i style={{ background: color(catValue) }} />{catValue}</button></>
    : '没有在做的事';
  const cat = catValue !== null && <button type="button" className="mini-cat" id="mini-cat" aria-haspopup="listbox" aria-expanded={catOpen}
    title={`分类：${catValue}（点开切换）`} onMouseDown={toggleCat}><i style={{ background: color(catValue) }} /><span>{catValue}</span></button>;
  const overText = progress.overMs > 0 ? `+${formatReadout(progress.overMs, 'mmss')}` : null;
  const stateEn = pending ? 'PENDING' : !running ? (resumeDescription ? 'PAUSED' : 'IDLE') : away ? 'AWAY' : overText ?? 'RUNNING';

  // 点名字就地变成透明输入框：待机时和点主窗口输入框一样，从这一刻起计时（待确认）
  const openEdit = () => {
    setNote(null); setError(null); setCatOpen(false); chosen.current = false;
    const startedHere = !running && !pending;
    if (startedHere) act({ type: 'beginPending', pending_id: null });
    const cardRun = snap.card && snap.entry?.cardId === snap.card.id ? snap.card : null;
    const editingRun = !!(snap.entry && snap.entry.project !== '待机') && !snap.pending;
    const draft = cardRun ? cardRun.content : editingRun ? snap.entry!.description : '';
    setEdit({ startedHere, snap, draft, rename: !!cardRun || editingRun, project: '未分类' });
  };
  const closeEdit = (keepIt: boolean) => {
    if (!edit) return;
    setCatOpen(false);
    if (chosen.current) { chosen.current = false; setEdit(null); return; }
    const s = edit.snap, cardRun = s.card && s.entry?.cardId === s.card.id ? s.card : null, now_ = latest.current ?? s;
    const editingRun = !!(s.entry && s.entry.project !== '待机') && !s.pending;
    const raw = edit.draft.trim();
    setEdit(null);
    if (keepIt && cardRun && raw) {
      if (raw !== cardRun.content) act({ type: 'editCard', revision: now_.revision, cardId: cardRun.id, content: raw });
      return;
    }
    if (keepIt && raw) {
      const p = parseEntryText(raw, snap.projects.map(o => o.name));
      const description = p.description || raw;
      // 名字里写了 @项目 以名字为准；写新事件时没写就用先选的分类
      const project = p.project ?? (editingRun ? s.entry!.project : edit.project);
      const tags = p.tags.length ? [...new Set([...(editingRun ? s.entry!.tags : []), ...p.tags])] : (editingRun ? s.entry!.tags : []);
      act({ type: 'editOpen', revision: now_.revision, pending_id: now_.pending_id, patch: { description, project, tags } });
      return;
    }
    if (!keepIt && edit.startedHere && now_.pending_id) act({ type: 'cancelPending', pending_id: now_.pending_id });
  };
  // 选中自动完成里的一项：不按离开写盘，直接开始这件事（同主窗口 useEntry.choose）
  const choose = (command: Parameters<Send>[0]) => {
    const s = latest.current ?? snap;
    chosen.current = true; setCatOpen(false);
    act({ ...command, revision: s.revision, pending_id: s.pending_id });
    setEdit(null);
  };
  // 改读数：确认以后按原来的时刻、目标和读数，带上预览再交一次；版本取最新的快照
  const submit = async (req: ReadoutRequest, seen: unknown): Promise<ReadoutOutcome> => {
    const s = latest.current ?? snap;
    const o = await send({ type: 'setReadout', revision: s.revision, pending_id: s.pending_id, target: req.target, milliseconds: req.milliseconds, seen: seen ?? null }, req.at);
    return o.kind === 'confirm' ? { kind: 'confirm', hit: o.hit, plan: o.plan } : o.kind === 'error' ? { kind: 'error', message: o.message } : { kind: 'done', hit: [] };
  };
  const canEditTime = !!running || !!pending || (!!entry && !resumeDescription);
  const target = () => pending ? { mode: 'pending' as const, id: pending.id }
    : c && running ? { mode: 'ref' as const, id: c.id }
    : running ? { mode: 'entry' as const, id: running.id }
    : entry && !resumeDescription ? { mode: 'idle' as const, id: entry.id } : null;

  const pop = popKind === 'cat' && catValue !== null ? <CatList projects={snap.projects} value={catValue} onPick={pickProject} />
    : popKind === 'suggest' ? <Suggest query={edit!.draft} data={snap.suggest}
      onFavorite={id => choose({ type: 'startFavorite', presetId: id })}
      onCard={id => choose({ type: 'startCard', targetCardId: id })}
      onRecent={id => choose({ type: 'continueEntry', targetEntryId: id })} />
    : null;

  return <div ref={root}>
    <MiniWindow mode={mode} strip={c ? '卡' : '—'} meta={meta} cat={cat || undefined} title={title} stateEn={stateEn} miniFilled={progress.miniFilled} running={!!running} topoDepth={0}
      paused={!running} canResume={!!resumeDescription}
      onPause={() => act({ type: 'pause' })} onResume={() => act({ type: 'resume' })}
      onComplete={c && c.status === '进行中' ? () => act({ type: 'complete', cardId: c.id }) : undefined}
      onClose={() => void onClose().catch(e => setError(`小窗没能关闭：${String(e)}`))} onTitle={openEdit}
      titleInput={edit && <InlineInput id="mini-name" className="mini-title-in" aria-label="名称"
        placeholder="I am working on…" value={edit.draft}
        onChange={draft => { setEdit({ ...edit, draft }); if (catOpen) setCatOpen(false); }}
        onDone={closeEdit} />}
      digits={<TimeField key={snap.epoch} id="mini-elapsed" kind="mmss" shown={total} disabled={!canEditTime} target={target} submit={submit}
        onNote={guard.bind(snap.epoch, setNote)}>{formatReadout(total, 'mmss')}</TimeField>}
      caption={stale ? '主窗口未响应' : error ? error : note ? <HitNote note={note} /> : null}
      pop={pop} popUp={!!pop && !!popFit?.up} popStyle={pop && popFit ? { maxHeight: popFit.max } : undefined} />
  </div>;
}
