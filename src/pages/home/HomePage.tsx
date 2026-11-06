import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motionLevel } from '../../ui/effects/animate';
import type { ReactNode } from 'react';
import { Icon } from '../../ui/icons/Icon';
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
import { RestDialog } from './RestDialog';
import { InsertCard } from './InsertCard';
import { GUIDES, GuideCard } from './GuideCard';
import type { GuideKind } from './GuideCard';
import { ReviewCard } from './ReviewCard';
import { CardFrame } from './CardFrame';
import { playAfterWipe, playColdIntro, playResumeIntro } from './intro';
import { TimerBar } from './TimerBar';
import type { EntryValue, TimerActions } from './TimerBar';
import type { Cover, ReadoutOutcome, ReadoutRequest } from './TimeField';
import { ManualForm } from './ManualForm';
import { favorites, timerView } from './timerView';
import { cardArea } from './cardArea';
import { FreeCard } from './FreeCard';
import { FusedCard } from './FusedCard';
import { ActivityActions } from './ActivityActions';
import { ProjectPicker } from '../../ui/controls/ProjectPicker';
import { TagPicker } from '../../ui/controls/TagPicker';

/** 首页需要的动作。由外壳的适配层（app/actions）提供，出错由适配层统一报告。 */
export interface HomeActions {
  start(cardId: string, at: string): Promise<unknown>;
  checkComplete(cardId: string, at: string): Promise<{ remainingMinutes: number; at: string } | undefined>;
  /** 打开缩小对话框时现算今天的量和下限（G6 审核 S2） */
  checkSplit(cardId: string, at: string): Promise<{ todayGoal: number | null; minToday: number; minutesToday: number } | undefined>;
  /** fromMini：小窗点的完成（两段式），操作历史的来源记小窗 */
  complete(cardId: string, at: string, note: string, keepGoing: boolean, fromMini?: boolean): Promise<unknown>;
  /** 缩小 = 拆成两项（ADR 0021 第 4 条） */
  split(cardId: string, input: { todayContent: string; restContent: string; restMinutes: number | null }, at: string): Promise<unknown>;
  editContent(cardId: string, content: string, at: string): Promise<unknown>;
  editMeta(cardId: string, project: string | null, tags: string[], at: string): Promise<unknown>;
  /** 从今天的板子抽一张（只读）；G7 换成翻卡。现在：抽到就直接开始 */
  draw(at: string): Promise<{ kind: string; card?: { id: string } } | undefined>;
  resume(at: string): Promise<unknown>;
  /** 〔结束原任务〕（已定 19、26） */
  endOriginal(at: string): Promise<unknown>;
  continueTimer(at: string): Promise<unknown>;
  wake(at: string): Promise<unknown>;
  /** 主动休息（已定 48、55、63）：插入一条「休息」，项目缺省「休息」 */
  rest(at: string, project?: string): Promise<unknown>;
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
export interface HomeLook { titleScale: number; topoMode: TopoMode; topoDepth: number; timeboxDefault: number }

/** 首页卡片的显示数据：closedEffectiveMs + (现在 − 当前段开始)。小窗也用它。 */
export function cardView(home: HomeSlice, now: number): TaskCardView | null {
  const c = home.card;
  if (!c) return null;
  const totalMs = home.closedEffectiveMs + (home.currentSegStartedAt ? now - Date.parse(home.currentSegStartedAt) : 0);
  // 已定 23：大读数是今天在这张卡上的时间，进度按今天的量；总累计放标题下小字
  const elapsedMs = home.closedTodayMs + (home.todaySegStartedAt ? Math.max(0, now - Date.parse(home.todaySegStartedAt)) : 0);
  const goal = c.type === '时间盒卡' ? home.todayGoal ?? c.goalMinutes : null;
  const away = home.awayActivity !== null;
  // 不属于项目的卡不占背包格，不显示「/03」
  return { id: c.id, slotNo: c.slotNo, slotOf: c.slotNo === LOOSE.slot ? undefined : c.slotOf, task: c.task, type: c.type, goalMinutes: c.goalMinutes, content: c.content,
    progressNote: c.progressNote || undefined, elapsedMs, totalMs, todayGoal: goal, awayActivity: home.awayActivity ?? undefined,
    progress: cardProgress(elapsedMs, goal, c.status === '进行中' && !away, away) };
}

/** 每秒刷新一次「现在」。 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  return now;
}

type DialogState = { kind: 'short'; cardId: string; remaining: number; at: string; fromMini?: boolean }
  | { kind: 'complete'; cardId: string; at: string; fromMini?: boolean } | { kind: 'shrink'; cardId: string; todayGoal: number | null; minToday: number; minutesToday: number }
  | { kind: 'rest'; at: string } | null;

/**
 * 首页：只显示一件事。按 home.mode 显示任务卡、引导卡、休息卡或回顾卡。
 * completeAt：小窗里点了完成、主窗口还原以后，由外壳传进来，接着走完成流程（架构 §5.5）。
 * shrinkFor：跳过信号里选了「拆小」，由外壳传进来卡 id，打开缩小对话框。
 */
export function HomePage({ actions, look, intro, completeAt, onCompleteConsumed, shrinkFor, onShrinkConsumed, onGuide, onOpenReview, drawer, onDraw, onOpenBag }:
  { /** 背包抽屉（外壳给，ADR 0021 第 2 条）：把首页的卡包进去，拉开时卡退后一点 */ drawer?: (stage: ReactNode) => ReactNode;
    /** 抽卡交给外壳（翻卡在抽屉那一层演）；没给就照旧抽到直接开始 */ onDraw?: (at: string) => void;
    /** 〔今日任务板〕：拉开背包抽屉 */ onOpenBag?: () => void;
    actions: HomeActions; look: HomeLook; intro: { kind: 'cold' | 'resume' } | null; completeAt: { cardId: string; at: string } | null; onCompleteConsumed: () => void;
    shrinkFor: string | null; onShrinkConsumed: () => void;
    onGuide: (kind: GuideKind) => void; onOpenReview: () => void }) {
  const home = useStore(appStore, s => s.home), cards = useStore(appStore, s => s.cards);
  const entries = useStore(appStore, s => s.entries), tasks = useStore(appStore, s => s.backpack.tasks), projects = useStore(appStore, s => s.backpack.pool.projects), settings = useStore(appStore, s => s.settings);
  const mains = useStore(appStore, s => s.backpack.pool.mains);
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
  async function beginComplete(cardId: string, at: string, fromMini = false) {
    const card = cards.find(c => c.id === cardId);
    if (card?.type === '时间盒卡') {
      const check = await actions.checkComplete(cardId, at);
      if (!check) return;
      if (check.remainingMinutes > 0) { setDialog({ kind: 'short', cardId, remaining: Math.ceil(check.remainingMinutes), at, fromMini }); return; }
    }
    setDialog({ kind: 'complete', cardId, at, fromMini });
  }
  async function beginShrink(cardId: string, at: string) {
    const check = await actions.checkSplit(cardId, at);
    if (check) setDialog({ kind: 'shrink', cardId, ...check });
  }
  // completeAt 只由小窗的「完成」传进来；当前卡已经换了就按主窗口操作记
  useEffect(() => {
    if (!completeAt || !home.card) return;
    onCompleteConsumed();
    void beginComplete(home.card.id, completeAt.at, home.card.id === completeAt.cardId);
  }, [completeAt]);
  useEffect(() => {
    if (!shrinkFor) return;
    onShrinkConsumed();
    if (home.card?.id === shrinkFor) void beginShrink(shrinkFor, new Date().toISOString());
  }, [shrinkFor]);

  // 抽卡（ADR 0021 第 2 条）：只读拿到结果；抽到就开始那一张。板子空着、带过来的待确认等情况由 G7 的抽屉处理
  async function drawAndStart(at: string) {
    if (onDraw) { onDraw(at); return; }
    const result = await actions.draw(at);
    if (result?.kind === 'task' && result.card) await actions.start(result.card.id, at);
  }

  // 计时条的动作：点击时刻在这里取；抽卡、开始卡和卡区一样走 act，换卡期间按钮不可点
  const now_ = () => new Date().toISOString(), favs = favorites(settings);
  // 收藏：计时时从待确认的起点开始；手动补录时用它填表
  const startFavorite = (id: string) => {
    const f = favs.find(x => x.id === id);
    if (!f) return;
    if (!fused && timerMode === 'manual') setPrefill({ description: f.name, project: f.project, tags: f.tags }); else void actions.startPreset(id, now_());
  };
  const timerActions: TimerActions = {
    beginPending: () => void actions.beginPending(now_()),
    cancelPending: id => void actions.cancelPending(id, now_()),
    startFree: v => void actions.startFree(v, now_()),
    editOpen: (id, patch) => void actions.editOpen(id, patch, now_()),
    pause: () => void actions.pause(now_()),
    stop: () => void actions.stop(now_()),
    resume: () => void act(() => actions.resume(now_())),
    continueTimer: () => void act(() => actions.continueTimer(now_())),
    draw: () => void act(() => drawAndStart(now_())),
    openBoard: () => onOpenBag?.(),
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
    actions: <CardActions running={c.status === '进行中'} busy={busy || !!wipe}
      onStart={at => void act(() => actions.start(c.id, at))}
      onComplete={at => void beginComplete(c.id, at)}
      onShrink={at => void beginShrink(c.id, at)} />,
    fx: wipe && <Wipe no={wipe.no} meta={wipe.meta} title={wipe.title} onCovered={() => setFrozen(null)}
      onDone={() => { setWipe(null); if (stage.current) playAfterWipe(stage.current); }} />,
  };
  let body;
  // 插入结束（从哪儿结束的都算）时，插入卡先演完收走再拿掉；同一帧里接着渲染，不让它先卸载再装回来（那样会重演落下）
  const [lastInsert, setLastInsert] = useState(home.insert), [exitingInsert, setExitingInsert] = useState<typeof home.insert>(null);
  // 〔插入事件〕刚点下、还没写名字的插入卡（用户 2026-11-06 确认）：只在界面上，不写盘。at 是点下那一刻（插入从这里算），leaving 是撤回时正在收走
  type Draft = { at: string; leaving: boolean; over: Extract<NonNullable<HomeSlice['insert']>['over'], { kind: 'card' }> };
  const [draftInsert, setDraftInsert] = useState<Draft | null>(null);
  if (home.insert !== lastInsert) {
    const prev = lastInsert;
    setLastInsert(home.insert);
    // 结束原任务：插入那一条变普通、接着开着，不演收走
    if (!home.insert && prev && motionLevel() !== 'off' && home.entry?.id !== prev.entryId) setExitingInsert(prev);
    // 插入有了（回车记下了，或别处开始了别的事）：同一张插入卡接着用，不再落下
    else if (home.insert) { setExitingInsert(null); setDraftInsert(null); }
  }
  // 卡换了、卡不在做了：还没写名字的插入卡跟着撤掉（什么都没记）
  if (draftInsert && !draftInsert.leaving && !home.insert && (home.card?.id !== draftInsert.over.cardId || home.card?.status !== '进行中')) setDraftInsert(null);
  const startDraftInsert = () => {
    const c = home.card;
    if (!c || c.status !== '进行中' || home.insert || draftInsert) return;
    // 卡上还留着待确认时，提交会从待确认的起点算（startOtherInTx），这里跟着用它
    const at = tv.pending?.startedAt ?? new Date().toISOString();
    const todayMs = home.closedTodayMs + (home.todaySegStartedAt ? Math.max(0, Date.parse(at) - Date.parse(home.todaySegStartedAt)) : 0);
    const track = full && mains.some(t => t.id === full.task_id) ? '主线' as const : '支线' as const;
    setDraftInsert({ at, leaving: false, over: { kind: 'card', cardId: c.id, title: c.content, track, todayMs, todayGoal: live?.todayGoal ?? null } });
  };
  const draftView: NonNullable<HomeSlice['insert']> | null = draftInsert
    ? { paused: false, canContinue: false, entryId: '', name: '', project: '未分类', startedAt: draftInsert.at, closedMs: 0, over: draftInsert.over } : null;
  const shownInsert = home.insert ?? exitingInsert ?? draftView;
  const drafting = !home.insert && !exitingInsert ? draftInsert : null;
  // 〔休息一下〕（已定 55、63）：做着卡、没在插入时显示；点下那一刻是开始时刻，先选项目
  const restButton = home.card?.status === '进行中' && !tv.away && !tv.pending
    ? <button type="button" className="c-rest" title="插一段休息，这张卡等你回来" onClick={() => setDialog({ kind: 'rest', at: new Date().toISOString() })}><Icon name="pause" />休息一下</button> : null;
  // 0.3.1：降级休息卡不再出现（0.3.0 遗留的 state.rest 由换日处理一次，ADR 0021 第 6、7 条）
  if (area === 'free') body = <FreeCard view={tv} draft={draft} now={now} look={cardLook} titleScale={look.titleScale} actions={timerActions}
    over={home.card?.status === '待做' ? { id: home.card.id, content: home.card.content } : null} />;
  else if (home.mode === 'review' && home.review) body = <ReviewCard period={home.review.period} resumeStep={home.review.resumeStep || null} betDue={home.review.betDue} look={cardLook} onOpen={onOpenReview} />;
  else if (home.mode === 'blank') body = <CardFrame look={cardLook} slotNo="—" slotLabel="READY">
    <div /><div className="alt-hero"><h1>现在做什么？</h1><p>从今日任务板上抽一张，开始下一件事。</p></div><div />
    <div className="foot"><ActivityActions className="actions" disabled={!!tv.away}><ActionButton primary cn="今日任务板" en="TODAY" icon="cards" onClick={() => onOpenBag?.()} /></ActivityActions></div>
  </CardFrame>;
  else if (home.mode === 'task' && view && task) {
    const corner = <>
      {home.noMainHint && <span className="c-hint">还没有主线</span>}
      {restButton}
    </>;
    body = <TaskCard view={view} look={cardLook} titleScale={look.titleScale} corner={corner} picks={task.picks} actionsDisabled={!!tv.away}
      stateText={tv.away && home.card?.status === '进行中' && !tv.pending ? ['进行中（暂停）', 'PAUSED'] : undefined}
      onEditContent={task.onEditContent} actions={task.actions} fx={task.fx} />;
  } else body = <GuideCard kind={home.mode === 'guide' ? home.guideKind : 'allDone'} look={cardLook} onAction={() => onGuide(home.mode === 'guide' ? home.guideKind : 'allDone')} />;

  // 融合布局：首页只有一张大卡（休息时是休息卡）。引导、回顾不再占整张卡，改成卡头右边的提示，输入框一直在
  const guide = home.mode === 'guide' ? GUIDES[home.guideKind] : null;
  if (fused && home.mode !== 'rest') body = <FusedCard key={home.card?.id ?? 'none'} view={tv} now={now} look={cardLook} titleScale={look.titleScale} actions={timerActions}
    card={home.mode === 'task' && home.card ? home.card : null} cardView={home.mode === 'task' ? view : null}
    cardPicks={task?.picks} cardActions={task?.actions} onEditContent={task?.onEditContent} fx={task?.fx}
    onInsertEvent={home.mode === 'task' && home.card?.status === '进行中' ? startDraftInsert : undefined}
    corner={<>
      {home.noMainHint && <span className="c-hint">还没有主线</span>}
      {home.mode === 'task' && restButton}
      {guide && <><span className="c-hint">{guide.title}</span><button type="button" className="c-link" onClick={() => onGuide(home.guideKind)}>{guide.cn}</button></>}
      {home.mode === 'review' && home.review && <><span className="c-hint">每周回顾</span>
        <button type="button" className="c-link" onClick={onOpenReview}>{home.review.resumeStep ? '接着回顾' : '开始回顾'}</button></>}
    </>} />;

  return <div className={`home${fused ? ' fused' : ''}`}>
    {/* 分开布局插入时，计时条写正在计的那件事（插入的事），可以改名字、项目、标签（用户 2026-11-06）；插入卡下面照常 */}
    {!fused && <TimerBar view={home.insert && tv.away ? { ...tv, entry: tv.away, away: null, idle: tv.away.project === '待机', paused: home.insert.paused ? home.insert.name : null,
      insertRun: { closedMs: home.insert.closedMs, paused: home.insert.paused } } : tv} actions={timerActions} mode={timerMode} onMode={setTimerMode} onDraft={setDraft} manual={manualForm} />}
    <div ref={stage} className="home-stage">
    {(drawer ?? (x => x))(shownInsert
      ? <InsertCard key={shownInsert.over.kind === 'card' ? shownInsert.over.cardId : 'free'} insert={shownInsert} now={now} look={cardLook} titleScale={look.titleScale}
          exiting={drafting ? drafting.leaving : !home.insert} onExited={() => { setExitingInsert(null); setDraftInsert(null); }}
          place={settings.insertBackPlace}
          // 还没写名字：〔回到任务〕/ Esc 只是撤回（没写过盘），收走演完再拿掉
          onBack={drafting ? async () => { setDraftInsert(d => d && { ...d, leaving: true }); return true; }
            : async () => { await act(() => actions.resume(new Date().toISOString())); return appStore.getState().home.insert === null; }}
          draft={drafting ? { projects, onCreateProject: name => void actions.createProject(name, now_()),
            // 回车：从点下那一刻开始插入这件事（做卡时开始别的事 = 插入，startOtherInTx）
            onSubmit: async v => { await act(() => actions.startFree({ description: v.description, project: v.project, tags: [] }, drafting.at)); return appStore.getState().home.insert !== null; } } : undefined}
          onEndOriginal={() => act(() => actions.endOriginal(new Date().toISOString()))}
          onPause={() => void actions.pause(new Date().toISOString())} onContinue={() => void act(() => actions.continueTimer(new Date().toISOString()))}>{body}</InsertCard>
      : body)}
    {dialog?.kind === 'rest' && <RestDialog projects={projects} onCancel={() => setDialog(null)}
      onConfirm={project => { const at = dialog.at; setDialog(null); void act(() => actions.rest(at, project)); }} />}
    {dialog?.kind === 'short' && <TimeboxShort data={{ cardId: dialog.cardId, remainingMinutes: dialog.remaining, at: dialog.at }} dismiss={() => setDialog(null)}
      resolve={r => setDialog(r.choice === 'stop' ? { kind: 'complete', cardId: dialog.cardId, at: r.at, fromMini: dialog.fromMini } : null)} />}
    {dialog?.kind === 'complete' && <CompleteDialog at={dialog.at} onCancel={() => setDialog(null)}
      onConfirm={r => { setDialog(null); void act(() => actions.complete(dialog.cardId, r.at, r.note, r.continueCard, dialog.fromMini)); }} />}
    {dialog?.kind === 'shrink' && full && home.card?.id === full.id && <ShrinkDialog original={full.content} type={full.type}
      todayGoal={dialog.todayGoal} minToday={dialog.minToday} minutesToday={dialog.minutesToday} onCancel={() => setDialog(null)}
      onConfirm={r => { setDialog(null); void act(() => actions.split(dialog.cardId, { todayContent: r.todayContent, restContent: r.restContent, restMinutes: r.restMinutes }, r.at)); }} />}
    </div>
  </div>;
}
