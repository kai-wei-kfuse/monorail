import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../store/appStore';
import type { HomeSlice } from '../../store/homeSlice';
import type { TopoMode } from '../../ui/effects/Topo';
import { Wipe } from '../../ui/effects/Wipe';
import { ActionButton } from '../../ui/controls/Button';
import { cardProgress } from '../../widgets/cardProgress';
import { LOOSE } from '../../shared/backpack';
import { TimeboxShort } from '../../widgets/notices/TimeboxShort';
import type { TaskCardView } from './TaskCard';
import { TaskCard } from './TaskCard';
import { CardActions } from './CardActions';
import { CompleteDialog } from './CompleteDialog';
import { ShrinkDialog } from './ShrinkDialog';
import { GUIDES, GuideCard } from './GuideCard';
import type { GuideKind } from './GuideCard';
import { RestCard } from './RestCard';
import { ReviewCard } from './ReviewCard';
import { CardFrame } from './CardFrame';
import { playAfterWipe, playColdIntro, playResumeIntro } from './intro';
import { TimerBar } from './TimerBar';
import type { EntryValue, TimerActions } from './TimerBar';
import type { Cover, ReadoutOutcome, ReadoutRequest } from './TimeField';
import { PresetRow } from './PresetRow';
import { ManualForm } from './ManualForm';
import { favorites, timerView } from './timerView';
import { cardArea } from './cardArea';
import { FreeCard } from './FreeCard';
import { FusedCard } from './FusedCard';
import { Dialog } from '../../ui/overlay/Dialog';
import { ProjectPicker } from '../../ui/controls/ProjectPicker';
import { TagPicker } from '../../ui/controls/TagPicker';

/** 首页需要的动作。由外壳的适配层（app/actions）提供，出错由适配层统一报告。 */
export interface HomeActions {
  start(cardId: string, at: string): Promise<unknown>;
  checkComplete(cardId: string, at: string): Promise<{ remainingMinutes: number; at: string } | undefined>;
  complete(cardId: string, at: string, note: string, keepGoing: boolean): Promise<unknown>;
  shrink(cardId: string, input: { content: string; type: '结果卡' | '时间盒卡'; minutes: number | null }, at: string): Promise<unknown>;
  redraw(cardId: string | null, at: string): Promise<unknown>;
  editContent(cardId: string, content: string, at: string): Promise<unknown>;
  editMeta(cardId: string, project: string | null, tags: string[], at: string): Promise<unknown>;
  draw(at: string): Promise<unknown>;
  resume(at: string): Promise<unknown>;
  wake(at: string): Promise<unknown>;
  returnFromRest(answer: string, at: string): Promise<unknown>;
  // 计时条
  beginPending(at: string): Promise<unknown>;
  cancelPending(pendingId: string, at: string): Promise<unknown>;
  startFree(value: EntryValue, at: string): Promise<unknown>;
  editOpen(entryId: string, patch: Partial<EntryValue>, at: string): Promise<unknown>;
  pause(at: string): Promise<unknown>;
  stop(at: string): Promise<unknown>;
  continueEntry(entryId: string, at: string): Promise<unknown>;
  commitReadout(req: ReadoutRequest, seen: unknown): Promise<ReadoutOutcome>;
  manual(value: EntryValue, start: string, end: string, at: string): Promise<unknown>;
  overlaps(start: string, end: string): Cover[];
  startPreset(presetId: string, at: string): Promise<unknown>;
  favorite(entryId: string, at: string): Promise<unknown>;
  reorderFavorites(ids: string[], at: string): Promise<unknown>;
  createProject(name: string, at: string): Promise<unknown>;
  createTag(tag: string, at: string): Promise<unknown>;
}
export interface HomeLook { titleScale: number; topoMode: TopoMode; topoDepth: number; shrinkMaxLevel: number; timeboxDefault: number }

/** 首页卡片的显示数据：closedEffectiveMs + (现在 − 当前段开始)。小窗也用它。 */
export function cardView(home: HomeSlice, now: number): TaskCardView | null {
  const c = home.card;
  if (!c) return null;
  const elapsedMs = home.closedEffectiveMs + (home.currentSegStartedAt ? now - Date.parse(home.currentSegStartedAt) : 0);
  const away = home.awayActivity !== null;
  // 不属于项目的卡不占背包格，不显示「/03」
  return { id: c.id, slotNo: c.slotNo, slotOf: c.slotNo === LOOSE.slot ? undefined : c.slotOf, task: c.task, type: c.type, goalMinutes: c.goalMinutes, content: c.content,
    progressNote: c.progressNote || undefined, elapsedMs, awayActivity: home.awayActivity ?? undefined,
    progress: cardProgress(elapsedMs, c.goalMinutes, c.status === '进行中' && !away, away) };
}

/** 每秒刷新一次「现在」。 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  return now;
}

type DialogState = { kind: 'short'; cardId: string; remaining: number; at: string } | { kind: 'complete'; cardId: string; at: string } | { kind: 'shrink'; cardId: string }
  | { kind: 'manual' } | null;

/**
 * 首页：只显示一件事。按 home.mode 显示任务卡、引导卡、休息卡或回顾卡。
 * completeAt：小窗里点了完成、主窗口还原以后，由外壳传进来，接着走完成流程（架构 §5.5）。
 * shrinkFor：跳过信号里选了「拆小」，由外壳传进来卡 id，打开缩小对话框。
 */
export function HomePage({ actions, look, intro, completeAt, onCompleteConsumed, shrinkFor, onShrinkConsumed, onGuide, onOpenReview, onAddRest }:
  { actions: HomeActions; look: HomeLook; intro: { kind: 'cold' | 'resume' } | null; completeAt: string | null; onCompleteConsumed: () => void;
    shrinkFor: string | null; onShrinkConsumed: () => void;
    onGuide: (kind: GuideKind) => void; onOpenReview: () => void; onAddRest?: () => void }) {
  const home = useStore(appStore, s => s.home), cards = useStore(appStore, s => s.cards);
  const entries = useStore(appStore, s => s.entries), tasks = useStore(appStore, s => s.backpack.tasks), projects = useStore(appStore, s => s.backpack.pool.projects), settings = useStore(appStore, s => s.settings);
  const [timerMode, setTimerMode] = useState<'timer' | 'manual'>('timer'), [prefill, setPrefill] = useState<EntryValue | null>(null);
  // 首页布局（设置 → 外观）：分开 = 上面计时条、下面卡区；融合 = 计时条并进大卡（UI 规范 §11.3）
  const fused = settings.homeLayout === 'fused';
  const [draft, setDraft] = useState<string | null>(null);   // 计时条里正在写的字，卡区照着显示
  const now = useNow();
  const stage = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  // 再抽一张：先冻结旧画面，换卡完成后用擂除盖住，盖住时才放出新卡（UI 规范 §8.3）
  const [frozen, setFrozen] = useState<TaskCardView | null>(null), [wipe, setWipe] = useState<{ no: string; meta: string; title: string } | null>(null);
  const cardLook = { topoMode: look.topoMode, topoDepth: look.topoDepth, paused: false };
  const live = cardView(home, now), view = frozen ?? live;
  const full = home.card ? cards.find(c => c.id === home.card!.id) : undefined;

  useLayoutEffect(() => {
    if (!stage.current || !intro) return;
    if (intro.kind === 'cold') return playColdIntro(document, stage.current, stage.current.querySelector('.digits'));
    else playResumeIntro(stage.current);
  }, [intro]);

  async function act(work: () => Promise<unknown>) { setBusy(true); try { await work(); } finally { setBusy(false); } }
  async function beginComplete(cardId: string, at: string) {
    const card = cards.find(c => c.id === cardId);
    if (card?.type === '时间盒卡') {
      const check = await actions.checkComplete(cardId, at);
      if (!check) return;
      if (check.remainingMinutes > 0) { setDialog({ kind: 'short', cardId, remaining: Math.ceil(check.remainingMinutes), at }); return; }
    }
    setDialog({ kind: 'complete', cardId, at });
  }
  useEffect(() => {
    if (!completeAt || !home.card) return;
    onCompleteConsumed();
    void beginComplete(home.card.id, completeAt);
  }, [completeAt]);
  useEffect(() => {
    if (!shrinkFor) return;
    onShrinkConsumed();
    if (home.card?.id === shrinkFor && home.card.shrink === 'ok') setDialog({ kind: 'shrink', cardId: shrinkFor });
  }, [shrinkFor]);

  async function redraw(at: string) {
    if (!home.card || !live) return;
    setFrozen(live);
    await act(() => actions.redraw(home.card!.id, at));
    const next = appStore.getState().home.card;
    if (!next) { setFrozen(null); return; }
    setWipe({ no: next.slotNo, meta: `${next.task} · ${next.type}${next.goalMinutes ? ` · ${next.goalMinutes} 分钟` : ''}`, title: next.content.replace(/[[\]]/g, '') });
  }

  // 计时条的动作：点击时刻在这里取；抽卡、开始卡和卡区一样走 act，换卡期间按钮不可点
  const now_ = () => new Date().toISOString(), favs = favorites(settings);
  // 收藏：计时时从待确认的起点开始；手动补录时用它填表
  const startFavorite = (id: string) => {
    const f = favs.find(x => x.id === id);
    if (!f) return;
    if (fused ? dialog?.kind === 'manual' : timerMode === 'manual') setPrefill({ description: f.name, project: f.project, tags: f.tags }); else void actions.startPreset(id, now_());
  };
  const timerActions: TimerActions = {
    beginPending: () => void actions.beginPending(now_()),
    cancelPending: id => void actions.cancelPending(id, now_()),
    startFree: v => void actions.startFree(v, now_()),
    editOpen: (id, patch) => void actions.editOpen(id, patch, now_()),
    pause: () => void actions.pause(now_()),
    stop: () => void actions.stop(now_()),
    resume: () => void act(() => actions.resume(now_())),
    draw: () => void act(() => actions.draw(now_())),
    startFavorite,
    startCard: id => void act(() => actions.start(id, now_())),
    continueEntry: id => void actions.continueEntry(id, now_()),
    favorite: id => void actions.favorite(id, now_()),
    readout: actions.commitReadout,
    createProject: name => void actions.createProject(name, now_()),
    createTag: tag => void actions.createTag(tag, now_()),
  };

  // 分开布局：卡区跟着计时条走（cardArea）。休息时只显示休息卡
  const tv = timerView({ home, entries, cards, tasks, settings, projects }), area = cardArea(draft, tv, home.card?.status ?? null);
  const manualForm = <ManualForm projects={projects} knownTags={home.knownTags} overlaps={actions.overlaps} prefill={prefill}
    onAdd={(v, start, end) => void actions.manual(v, start, end, now_())}
    onCreateProject={name => void actions.createProject(name, now_())} onCreateTag={tag => void actions.createTag(tag, now_())} />;
  // 抽到的卡上的部件，两种布局共用。再抽一张的擦除演出期间，画面上还是旧卡，不让改
  // 卡头「记到」那一行：存在卡自己身上，正在计的那条跟着改。只改标签时，项目保持原来是单独设的还是跟随任务
  const c = home.card, task = c && {
    picks: <span className="c-meta c-picks">记到
      <ProjectPicker flat id="card-project" value={c.project} options={projects} onChange={p => void actions.editMeta(c.id, p, c.tags, now_())}
        onCreate={name => void actions.createProject(name, now_())} />
      <TagPicker flat id="card-tags" value={c.tags} options={home.knownTags} onChange={tags => void actions.editMeta(c.id, c.projectOverridden ? c.project : null, tags, now_())}
        onCreate={tag => void actions.createTag(tag, now_())} />
    </span>,
    onEditContent: frozen || wipe ? undefined : (cardId: string, content: string) => void act(() => actions.editContent(cardId, content, new Date().toISOString())),
    actions: <CardActions running={c.status === '进行中'} shrink={c.shrink} busy={busy || !!wipe}
      onStart={at => void act(() => actions.start(c.id, at))}
      onComplete={at => void beginComplete(c.id, at)}
      onShrink={() => setDialog({ kind: 'shrink', cardId: c.id })}
      onRedraw={at => void redraw(at)} />,
    fx: wipe && <Wipe no={wipe.no} meta={wipe.meta} title={wipe.title} onCovered={() => setFrozen(null)}
      onDone={() => { setWipe(null); if (stage.current) playAfterWipe(stage.current); }} />,
  };
  let body;
  if (home.mode === 'rest') body = <RestCard suggestion={home.rest?.suggestion ?? null} look={cardLook} onAddRest={onAddRest} onBack={(answer, at) => void act(() => actions.returnFromRest(answer, at))} />;
  else if (area === 'free') body = <FreeCard view={tv} draft={draft} now={now} look={cardLook} titleScale={look.titleScale} actions={timerActions}
    over={home.card?.status === '待做' ? { id: home.card.id, content: home.card.content } : null} />;
  else if (home.mode === 'review' && home.review) body = <ReviewCard period={home.review.period} resumeStep={home.review.resumeStep || null} betDue={home.review.betDue} look={cardLook} onOpen={onOpenReview} />;
  else if (home.mode === 'blank') body = <CardFrame look={cardLook} slotNo="—" slotLabel="READY">
    <div /><div className="alt-hero"><h1>现在做什么？</h1><p>抽一张卡，开始下一件事。</p></div><div />
    <div className="foot"><ActionButton primary cn="抽卡" en="DRAW" icon="play" onClick={() => void act(() => actions.draw(new Date().toISOString()))} /></div>
  </CardFrame>;
  else if (home.mode === 'task' && view && task) {
    const away = home.awayActivity !== null;
    const corner = <>
      {away && <button type="button" className="c-link" onClick={() => void act(() => actions.resume(new Date().toISOString()))}>回来 · {home.awayActivity}</button>}
      {home.noMainHint && <span className="c-hint">还没有主线</span>}
    </>;
    body = <TaskCard view={view} look={cardLook} titleScale={look.titleScale} corner={corner} picks={task.picks}
      onEditContent={task.onEditContent} actions={task.actions} fx={task.fx} />;
  } else body = <GuideCard kind={home.mode === 'guide' ? home.guideKind : 'allDone'} look={cardLook} onAction={() => onGuide(home.mode === 'guide' ? home.guideKind : 'allDone')} />;

  // 融合布局：首页只有一张大卡（休息时是休息卡）。引导、回顾不再占整张卡，改成卡头右边的提示，输入框一直在
  const guide = home.mode === 'guide' ? GUIDES[home.guideKind] : null;
  if (fused && home.mode !== 'rest') body = <FusedCard key={home.card?.id ?? 'none'} view={tv} now={now} look={cardLook} titleScale={look.titleScale} actions={timerActions}
    card={home.mode === 'task' && home.card ? home.card : null} cardView={home.mode === 'task' ? view : null}
    cardPicks={task?.picks} cardActions={task?.actions} onEditContent={task?.onEditContent} fx={task?.fx} onManual={() => setDialog({ kind: 'manual' })}
    corner={<>
      {home.noMainHint && <span className="c-hint">还没有主线</span>}
      {guide && <><span className="c-hint">{guide.title}</span><button type="button" className="c-link" onClick={() => onGuide(home.guideKind)}>{guide.cn}</button></>}
      {home.mode === 'review' && home.review && <><span className="c-hint">每周回顾</span>
        <button type="button" className="c-link" onClick={onOpenReview}>{home.review.resumeStep ? '接着回顾' : '开始回顾'}</button></>}
    </>} />;

  return <div className={`home${fused ? ' fused' : ''}`}>
    {!fused && <TimerBar view={tv} actions={timerActions} mode={timerMode} onMode={setTimerMode} onDraft={setDraft} manual={manualForm} />}
    <PresetRow items={favs} onPick={startFavorite} onReorder={ids => void actions.reorderFavorites(ids, now_())} />
    <div ref={stage} className="home-stage">
    {body}
    {dialog?.kind === 'manual' && <Dialog en="MANUAL" title="手动补录" wide onClose={() => setDialog(null)}><div className="tbar f-manual">{manualForm}</div></Dialog>}
    {dialog?.kind === 'short' && <TimeboxShort data={{ cardId: dialog.cardId, remainingMinutes: dialog.remaining, at: dialog.at }} dismiss={() => setDialog(null)}
      resolve={r => setDialog(r.choice === 'stop' ? { kind: 'complete', cardId: dialog.cardId, at: r.at } : null)} />}
    {dialog?.kind === 'complete' && <CompleteDialog at={dialog.at} isShrinkCard={!!full?.shrunk_from} onCancel={() => setDialog(null)}
      onConfirm={r => { setDialog(null); void act(() => actions.complete(dialog.cardId, r.at, r.note, r.continueCard)); }} />}
    {dialog?.kind === 'shrink' && full && <ShrinkDialog original={full.content} type={full.type} timeboxMinutes={full.timebox_minutes}
      level={full.shrink_level} maxLevel={look.shrinkMaxLevel} defaultTimebox={look.timeboxDefault} onCancel={() => setDialog(null)}
      onConfirm={r => { setDialog(null); void act(() => actions.shrink(dialog.cardId, { content: r.content, type: r.type, minutes: r.timeboxMinutes }, r.at)); }} />}
    </div>
  </div>;
}
