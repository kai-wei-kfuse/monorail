import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { miniWindowSizes, resizeMiniWindow } from '../platform/miniWindow';
import { miniUnresponsive, miniWindowBus } from '../platform/windowBus';
import type { MiniCommand, MiniOutcome, MiniSnapshot, MiniWindowBus } from '../platform/windowBus';
import { formatReadout } from '../shared/duration';
import { parseEntryText } from '../shared/tags';
import { InlineInput } from '../ui/controls/InlineInput';
import { ProjectPicker } from '../ui/controls/ProjectPicker';
import { cardProgress } from '../widgets/cardProgress';
import { HitNote, TimeField } from '../pages/home/TimeField';
import type { ReadoutNote, ReadoutOutcome, ReadoutRequest } from '../pages/home/TimeField';
import { MiniWindow } from './shell/MiniWindow';

type Send = (command: Record<string, unknown> & { type: MiniCommand['type'] }, at?: string) => Promise<MiniOutcome>;
const REPLY_TIMEOUT_MS = 5000;
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 小窗入口（架构 §5.5，N6 接线草案 evidence/n6-contracts.md）：只接收主窗口发来的快照，只发命令；不读写数据目录，不建 Ctx。
 * 先注册快照和回复，再告诉主窗口准备好了。每条命令带上打开编辑时那份快照的 entryId / cardId；回复按 requestId 对上。
 * 超过 3 秒没收到快照，说明那一条写「主窗口未响应」。窗口宽高跟着内容走（支持普通小窗口与小小窗口切换）。
 */
export function MiniApp({ bus = miniWindowBus, onClose = () => getCurrentWindow().hide() }: { bus?: MiniWindowBus; onClose?: () => Promise<void> }) {
  const [snap, setSnap] = useState<MiniSnapshot | null>(null), latest = useRef<MiniSnapshot | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null), mountedAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  const [edit, setEdit] = useState<{ startedHere: boolean; snap: MiniSnapshot; draft: string } | null>(null);
  const [note, setNote] = useState<ReadoutNote | null>(null), [error, setError] = useState<string | null>(null);
  const waiting = useRef(new Map<string, (outcome: MiniOutcome) => void>()), root = useRef<HTMLDivElement>(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let alive = true;
    const offs = Promise.all([
      bus.onSnapshot(s => { latest.current = s; setSnap(s); setLastAt(Date.now()); document.documentElement.style.setProperty('--yellow', s.accent); }),
      bus.onReply(r => { waiting.current.get(r.requestId)?.(r.outcome); waiting.current.delete(r.requestId); }),
    ]).then(async fns => { if (alive) await bus.ready(); return fns; });
    return () => { alive = false; void offs.then(fns => fns.forEach(f => f())); };
  }, [bus]);
  const hasSnap = !!snap, mode = snap?.miniMode ?? 'mini';
  const stale = miniUnresponsive(lastAt, mountedAt.current, now);
  const hasPicker = Boolean(snap && (
    (snap.card && ((snap.entry && snap.entry.project !== '待机' && snap.entry.cardId === snap.card.id) || (snap.pending && snap.card.status === '待做'))) ||
    (snap.entry && snap.entry.project !== '待机')
  ));
  const prevMode = useRef<'mini' | 'tiny' | null>(null), targetW = useRef<number>(miniWindowSizes.mini.width), inFlight = useRef(false);
  // 窗口宽高所有权：仅在模式实际切换（mini <-> tiny）时重置为默认宽度，首份快照及平时保留用户当前宽度；高度随内容、说明换行与下拉筛选项变化
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !hasSnap || !('__TAURI_INTERNALS__' in window)) return;
    const bounds = miniWindowSizes[mode];
    const firstRun = prevMode.current === null;
    const modeChanged = !firstRun && prevMode.current !== mode;
    prevMode.current = mode;
    if (modeChanged) targetW.current = bounds.width;
    const fit = (forceWidth: boolean, forceApply: boolean) => {
      const curW = Math.round(window.innerWidth), curH = Math.round(window.innerHeight);
      if (!forceWidth && !inFlight.current && curW > 0) {
        targetW.current = Math.max(bounds.minWidth, Math.min(curW, bounds.maxWidth));
      }
      const r = el.getBoundingClientRect(), pop = el.querySelector<HTMLElement>('.combo-pop');
      const popH = pop ? Math.ceil(pop.getBoundingClientRect().bottom - r.top + 4) : 0;
      const w = targetW.current;
      const h = Math.max(Math.ceil(r.height) || bounds.height, popH);
      if (!forceApply && !forceWidth && w === curW && h === curH) return;
      inFlight.current = true;
      void resizeMiniWindow(mode, w, h)
        .catch(e => setError(`小窗没能调整尺寸：${String(e)}`))
        .finally(() => { inFlight.current = false; });
    };
    fit(modeChanged, firstRun || modeChanged);
    const ro = new ResizeObserver(() => fit(false, false));
    ro.observe(el);
    const combo = el.querySelector('.combo');
    if (!combo) return () => ro.disconnect();
    const mo = new MutationObserver(() => fit(false, false));
    mo.observe(combo, { childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [hasSnap, mode, stale, error, note, hasPicker]);

  const base = edit?.snap ?? snap;
  const send: Send = (command, at = new Date().toISOString()) => new Promise(resolve => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { waiting.current.delete(requestId); resolve({ kind: 'error', message: '主窗口未响应' }); }, REPLY_TIMEOUT_MS);
    waiting.current.set(requestId, outcome => { clearTimeout(timer); resolve(outcome); });
    void bus.send({ requestId, at, entryId: base?.entryId ?? null, cardId: base?.cardId ?? null, ...command } as MiniCommand)
      .catch(e => { waiting.current.delete(requestId); clearTimeout(timer); resolve({ kind: 'error', message: String(e) }); });
  });
  const act = (command: Parameters<Send>[0]) => void send(command).then(o => setError(o.kind === 'error' ? o.message : null));

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
  const pickProject = (project: string) => {
    const s = latest.current ?? snap;
    if (c) act({ type: 'editCard', revision: s.revision, cardId: c.id, content: c.content, project });
    else if (running) act({ type: 'editOpen', revision: s.revision, pending_id: s.pending_id, patch: { project } });
  };
  const meta = c || running
    ? <>记到 <ProjectPicker flat id="mini-project" value={currentProject} options={snap.projects} onChange={pickProject} /></>
    : '没有在做的事';
  const overText = progress.overMs > 0 ? `+${Math.floor(progress.overMs / 60_000)}:${pad(Math.floor(progress.overMs / 1000) % 60)}` : null;
  const stateEn = pending ? 'PENDING' : !running ? (resumeDescription ? 'PAUSED' : 'IDLE') : away ? 'AWAY' : overText ?? 'RUNNING';

  // 点名字就地变成透明输入框：待机时和点主窗口输入框一样，从这一刻起计时（待确认）
  const openEdit = () => {
    setNote(null); setError(null);
    const startedHere = !running && !pending;
    if (startedHere) act({ type: 'beginPending', pending_id: null });
    const cardRun = snap.card && snap.entry?.cardId === snap.card.id ? snap.card : null;
    const editingRun = !!(snap.entry && snap.entry.project !== '待机') && !snap.pending;
    const draft = cardRun ? cardRun.content : editingRun ? snap.entry!.description : '';
    setEdit({ startedHere, snap, draft });
  };
  const closeEdit = (keep: boolean) => {
    if (!edit) return;
    const s = edit.snap, cardRun = s.card && s.entry?.cardId === s.card.id ? s.card : null, now_ = latest.current ?? s;
    const editingRun = !!(s.entry && s.entry.project !== '待机') && !s.pending;
    const raw = edit.draft.trim();
    setEdit(null);
    if (keep && cardRun && raw) {
      if (raw !== cardRun.content) act({ type: 'editCard', revision: now_.revision, cardId: cardRun.id, content: raw });
      return;
    }
    if (keep && raw) {
      const p = parseEntryText(raw, snap.projects.map(o => o.name));
      const description = p.description || raw;
      const project = p.project ?? (editingRun ? s.entry!.project : '未分类');
      const tags = p.tags.length ? [...new Set([...(editingRun ? s.entry!.tags : []), ...p.tags])] : (editingRun ? s.entry!.tags : []);
      act({ type: 'editOpen', revision: now_.revision, pending_id: now_.pending_id, patch: { description, project, tags } });
      return;
    }
    if (!keep && edit.startedHere && now_.pending_id) act({ type: 'cancelPending', pending_id: now_.pending_id });
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

  return <div ref={root}>
    <MiniWindow mode={mode} strip={c ? '卡' : '—'} meta={meta} title={title} stateEn={stateEn} miniFilled={progress.miniFilled} running={!!running} topoDepth={0}
      paused={!running} canResume={!!resumeDescription}
      onPause={() => act({ type: 'pause' })} onResume={() => act({ type: 'resume' })}
      onComplete={c && c.status === '进行中' ? () => act({ type: 'complete', cardId: c.id }) : undefined}
      onClose={() => void onClose().catch(e => setError(`小窗没能关闭：${String(e)}`))} onTitle={openEdit}
      titleInput={edit && <InlineInput id="mini-name" className="mini-title-in" aria-label="名称"
        placeholder="I am working on…" value={edit.draft}
        onChange={draft => setEdit({ ...edit, draft })}
        onDone={closeEdit} />}
      digits={<TimeField id="mini-elapsed" kind="mmss" shown={total} disabled={!canEditTime} target={target} submit={submit} onNote={setNote}>{formatReadout(total, 'mmss')}</TimeField>}
      caption={stale ? '主窗口未响应' : error ? error : note ? <HitNote note={note} /> : null} />
  </div>;
}
