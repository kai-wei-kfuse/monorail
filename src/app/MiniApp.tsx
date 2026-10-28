import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { miniUnresponsive, miniWindowBus } from '../platform/windowBus';
import type { MiniCommand, MiniOutcome, MiniSnapshot, MiniWindowBus } from '../platform/windowBus';
import { formatReadout } from '../shared/duration';
import { cardProgress } from '../widgets/cardProgress';
import { HitNote, TimeField } from '../pages/home/TimeField';
import type { ReadoutNote, ReadoutOutcome, ReadoutRequest } from '../pages/home/TimeField';
import { MiniWindow } from './shell/MiniWindow';
import { MiniEdit } from './shell/MiniEdit';
import type { MiniEditValue } from './shell/MiniEdit';

type Send = (command: Record<string, unknown> & { type: MiniCommand['type'] }, at?: string) => Promise<MiniOutcome>;
const REPLY_TIMEOUT_MS = 5000;
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 小窗入口（架构 §5.5，N6 接线草案 evidence/n6-contracts.md）：只接收主窗口发来的快照，只发命令；不读写数据目录，不建 Ctx。
 * 先注册快照和回复，再告诉主窗口准备好了。每条命令带上打开编辑时那份快照的 entryId / cardId；回复按 requestId 对上。
 * 超过 3 秒没收到快照，说明那一条写「主窗口未响应」。窗口高度跟着内容走（编辑面板打开时变高）。
 */
export function MiniApp({ bus = miniWindowBus, onClose = () => getCurrentWindow().hide() }: { bus?: MiniWindowBus; onClose?: () => Promise<void> }) {
  const [snap, setSnap] = useState<MiniSnapshot | null>(null), latest = useRef<MiniSnapshot | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null), mountedAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  const [edit, setEdit] = useState<{ startedHere: boolean; snap: MiniSnapshot } | null>(null);
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
  // 窗口高度跟着内容：小窗本体 88，下面一条说明，编辑面板打开时再加上它
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    // 小窗还没有改尺寸的权限时 setSize 会失败，窗口就停在 88 高；开发预览里没有 Tauri，getCurrentWindow 直接抛错
    const fit = () => {
      try { void getCurrentWindow().setSize(new LogicalSize(520, Math.ceil(el.getBoundingClientRect().height))).catch(() => {}); } catch { /* 没有 Tauri */ }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
  const meta = c || running ? `记到 ${c?.project ?? running?.project ?? '未分类'}` : '没有在做的事';
  const overText = progress.overMs > 0 ? `+${Math.floor(progress.overMs / 60_000)}:${pad(Math.floor(progress.overMs / 1000) % 60)}` : null;
  const stateEn = pending ? 'PENDING' : !running ? (resumeDescription ? 'PAUSED' : 'IDLE') : away ? 'AWAY' : overText ?? 'RUNNING';
  const stale = miniUnresponsive(lastAt, mountedAt.current, now);

  // 点名字：待机时和点主窗口输入框一样，从这一刻起计时（待确认）
  const openEdit = () => {
    setNote(null); setError(null);
    const startedHere = !running && !pending;
    if (startedHere) act({ type: 'beginPending', pending_id: null });
    setEdit({ startedHere, snap });
  };
  const closeEdit = (save: MiniEditValue | null) => {
    if (!edit) return;
    const s = edit.snap, cardRun = s.card && s.entry?.cardId === s.card.id ? s.card : null, now_ = latest.current ?? s;
    setEdit(null);
    if (save && cardRun) { if (save.name.trim()) act({ type: 'editCard', revision: now_.revision, cardId: cardRun.id, content: save.name.trim(), project: save.project, tags: save.tags }); return; }
    if (save && save.name.trim()) { act({ type: 'editOpen', revision: now_.revision, pending_id: now_.pending_id, patch: { description: save.name.trim(), project: save.project, tags: save.tags } }); return; }
    if (edit.startedHere && now_.pending_id) act({ type: 'cancelPending', pending_id: now_.pending_id });
  };
  // 改读数：确认以后按原来的时刻、目标和读数，带上预览再交一次；版本取最新的快照
  const submit = async (req: ReadoutRequest, seen: unknown): Promise<ReadoutOutcome> => {
    const s = latest.current ?? snap;
    const o = await send({ type: 'setReadout', revision: s.revision, pending_id: s.pending_id, target: req.target, milliseconds: req.milliseconds, seen: seen ?? null }, req.at);
    return o.kind === 'confirm' ? { kind: 'confirm', hit: o.hit, plan: o.plan } : o.kind === 'error' ? { kind: 'error', message: o.message } : { kind: 'done', hit: [] };
  };
  const target = () => pending ? { mode: 'pending' as const, id: pending.id } : c && running ? { mode: 'ref' as const, id: c.id } : running ? { mode: 'entry' as const, id: running.id } : null;
  const editingRun = !!edit && !!(edit.snap.entry && edit.snap.entry.project !== '待机') && !edit.snap.pending;
  const editCard = edit?.snap.card && edit.snap.entry?.cardId === edit.snap.card.id ? edit.snap.card : null;

  return <div ref={root}>
    <MiniWindow strip={c ? '卡' : '—'} meta={meta} title={title} stateEn={stateEn} miniFilled={progress.miniFilled} running={!!running} topoDepth={0}
      paused={!running} canResume={!!resumeDescription}
      onPause={() => act({ type: 'pause' })} onResume={() => act({ type: 'resume' })}
      onComplete={c && c.status === '进行中' ? () => act({ type: 'complete', cardId: c.id }) : undefined}
      onClose={() => void onClose()} onTitle={openEdit}
      digits={<TimeField id="mini-elapsed" kind="mmss" shown={total} disabled={!running && !pending} target={target} submit={submit} onNote={setNote}>{formatReadout(total, 'mmss')}</TimeField>}
      editor={edit && <MiniEdit editing={editingRun} isCard={!!editCard} pendingSince={edit.snap.pending?.startedAt ?? (edit.startedHere ? new Date().toISOString() : null)}
        initial={editCard ? { name: editCard.content, project: editCard.project ?? edit.snap.entry!.project, tags: editCard.tags }
          : editingRun ? { name: edit.snap.entry!.description, project: edit.snap.entry!.project, tags: edit.snap.entry!.tags } : { name: '', project: '未分类', tags: [] }}
        projects={snap.projects} knownTags={snap.knownTags} onSave={v => closeEdit(v)} onCancel={() => closeEdit(null)} />}
      caption={stale ? '主窗口未响应' : error ? error : note ? <HitNote note={note} /> : '点名字改名称和项目，点时间改时间 · 按住空白处拖动'} />
  </div>;
}
