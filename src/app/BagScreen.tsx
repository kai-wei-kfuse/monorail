import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../store/appStore';
import { BagDrawer } from '../pages/home/drawer/BagDrawer';
import type { BagActions, BagData } from '../pages/home/drawer/BagDrawer';
import { FlipDeal } from '../pages/home/drawer/FlipDeal';
import type { FlipCard } from '../pages/home/drawer/FlipDeal';
import { cardView } from '../pages/home/HomePage';
import type { TaskCardView } from '../pages/home/TaskCard';
import { Dialog } from '../ui/overlay/Dialog';
import { Button } from '../ui/controls/Button';
import { motionLevel } from '../ui/effects/animate';
import { isPostCommitError } from '../services/commit';
import type { Ctx } from '../services/commit';
import * as backpack from '../services/backpackService';
import * as ideas from '../services/ideaService';
import * as preset from '../services/presetService';
import * as plan from '../services/planService';
import * as deal from '../services/dealService';
import { startCard } from '../services/homeService';
import { checkComplete, completeItem, pass } from '../services/cardService';
import { changeLists } from '../services/settingsService';
import type { HistorySource } from '../shared/history';
import type { IdeaInitialEditDraft } from '../shared/ideaWindow';

const HOME: HistorySource = { kind: 'manual', via: 'main', page: 'home' };
type Ask = { kind: 'plan' } | { kind: 'done' } | { kind: 'blocked'; reason: 'inserting' | 'rest' } | { kind: 'carry' } | null;

export interface BagStartPresentation {
  id: string;
  cardId: string;
  at: string;
  previousView: TaskCardView | null;
}

/**
 * 背包抽屉和抽卡的接线（ADR 0021 第 2 条）：数据来自 store 的 backpack / plan 投影，动作走 backpack / plan / idea / deal service。
 * 取代原来的背包页（BackpackScreen）。抽卡：drawFromPlan 只读拿结果，翻卡演完点〔开始〕走 startFromBag，〔换一张〕走 skipCard 再抽一次。
 */
export function BagScreen({ ctx, open, onOpen, onClose, drawAt, onDrawn, onBagStarted, onOpenIdeaWindow, onIdeaEditDirtyChange, maintenanceLocked, report, onInfo, children }:
  { ctx: Ctx; open: boolean; onOpen: () => void; onClose: () => void;
    /** 外壳给的抽卡请求（首页〔今日任务板〕旁的抽卡、板子底部〔抽一张〕）：每次变成新值就抽一次 */ drawAt: string | null; onDrawn: () => void;
    onBagStarted?: (req: BagStartPresentation) => void;
    onOpenIdeaWindow?: (recordId: string, title?: string, initialDraft?: IdeaInitialEditDraft | null) => void;
    onIdeaEditDirtyChange?: (dirty: boolean) => void;
    maintenanceLocked?: boolean;
    report: (error: unknown) => void; onInfo?: (title: string, text: string) => void; children: ReactNode }) {
  const view = useStore(appStore, s => s.backpack), planView = useStore(appStore, s => s.plan), home = useStore(appStore, s => s.home), cards = useStore(appStore, s => s.cards);
  // 设置从 store 读：改了设置就跟着重新渲染（不靠别的投影顺带刷新）
  const settings = useStore(appStore, s => s.settings);
  const [ask, setAsk] = useState<Ask>(null), [flip, setFlip] = useState<{ pick: FlipCard; pool: FlipCard[]; from: DOMRect | null; key: string } | null>(null);
  const [lastDraw, setLastDraw] = useState<string | null>(null);
  const [startingRef] = useState(() => ({ current: false }));
  const now = () => new Date().toISOString();
  const call = (work: () => Promise<unknown>) => { void work().catch(report); };

  const startFromBag = (cardId: string, at = now()) => {
    if (startingRef.current) return;
    startingRef.current = true;
    const previousView = cardView(appStore.getState().home, Date.parse(at));
    void (async () => {
      try {
        await startCard(ctx, cardId, at);
        setFlip(null);
        onClose();
        if (motionLevel() !== 'off') onBagStarted?.({ id: crypto.randomUUID(), cardId, at, previousView });
      } catch (error) {
        if (isPostCommitError(error)) {
          report(error);
          setFlip(null);
          onClose();
          if (!error.projectionFailed && motionLevel() !== 'off') {
            onBagStarted?.({ id: crypto.randomUUID(), cardId, at, previousView });
          }
        } else {
          report(error);
        }
      } finally {
        startingRef.current = false;
      }
    })();
  };

  const flipCard = (id: string): FlipCard => {
    const row = planView.today.rows.find(r => r.cardId === id), c = cards.find(x => x.id === id);
    const task = [...view.pool.mains, ...view.pool.sides].find(t => t.items.some(i => i.id === id));
    return { id, title: row?.title ?? c?.content ?? '', track: row?.track ?? task?.track ?? '支线', taskName: row?.taskName ?? (task && task.items.length > 1 ? task.name : null),
      todayMinutes: row?.todayMinutes ?? null, high: row?.priority === '高' };
  };
  const draw = (at: string) => call(async () => {
    const from = (document.querySelector('.bp-draw') ?? document.querySelector('.dock-toggle.bp-bag'))?.getBoundingClientRect() ?? null;
    const result = await deal.drawFromPlan(ctx, at);
    if (!result) return;
    if (result.kind === 'plan') { setAsk({ kind: 'plan' }); return; }
    if (result.kind === 'confirmCarry') { setAsk({ kind: 'carry' }); onOpen(); return; }
    if (result.kind === 'blocked') { setAsk({ kind: 'blocked', reason: result.reason }); return; }
    if (result.kind === 'done') { setAsk({ kind: 'done' }); return; }
    if (result.kind === 'guide') { onInfo?.('背包里还没有能做的事', '先在背包里新建一个任务，再排进今天。'); onOpen(); return; }
    // 动效关闭：不翻，直接开始（§11.15）
    if (motionLevel() === 'off') { startFromBag(result.card.id, now()); return; }
    setFlip({ pick: flipCard(result.card.id), pool: result.candidates.map(c => flipCard(c.card.id)), from, key: at });
  });
  // 外壳每次给一个新的 drawAt 就抽一次（G7 审核 N1：放进 effect，不在渲染里发请求）
  useEffect(() => { if (drawAt && drawAt !== lastDraw) { setLastDraw(drawAt); onDrawn(); draw(drawAt); } }, [drawAt]);

  const running = home.insert ? null : home.card?.status === '进行中' && home.entry?.cardId === home.card.id ? home.entry : home.entry && home.entry.project !== '待机' ? home.entry : null;
  const data: BagData = {
    pool: view.pool, tasks: view.tasks, queue: view.queue, ideas: view.ideas, doneIdeas: view.doneIdeas, plan: planView,
    ideaLimit: settings.ideaPoolLimit, defaultTimebox: settings.timeboxDefaultMinutes, knownTags: view.pool.knownTags,
    drawable: planView.today.drawable.length, inserting: !!home.insert, taskMode: settings.taskMode,
    interruptedCardId: home.insert?.over.kind === 'card' ? home.insert.over.cardId : null,
    pendingCardId: home.pending && home.card ? home.card.id : null,
    activeOrPausedCardId: home.card?.id ?? null,
    maintenanceLocked,
    now: home.insert ? { title: home.insert.name, startedAt: home.insert.startedAt ?? new Date().toISOString() }
      : running ? { title: home.card?.status === '进行中' ? home.card.content : running.description, startedAt: running.startedAt } : null,
  };
  const actions: BagActions = {
    planAdd: (day, cardId, priority, todayMinutes) => call(() => plan.add(ctx, day, { cardId, priority, todayMinutes }, now())),
    planRemove: (day, cardId) => call(() => plan.remove(ctx, day, cardId, now())),
    confirmCarry: keep => call(() => plan.confirmCarry(ctx, keep, now())),
    start: cardId => startFromBag(cardId, now()),
    draw: () => { onClose(); draw(now()); },
    createTask: draft => call(() => backpack.createTask(ctx, draft, now())),
    addItem: (taskId, content) => call(() => backpack.addItem(ctx, taskId, content, now())),
    freezeTask: id => call(() => backpack.freezeTask(ctx, id, now())),
    abandonTask: id => call(() => backpack.abandonTask(ctx, id, now())),
    restoreTask: (id, slot, makeRoom) => call(() => backpack.restoreTask(ctx, id, slot, now(), makeRoom)),
    completeTask: id => call(() => backpack.completeTask(ctx, id, now())),
    reopenTask: (id, makeRoom) => call(() => {
      const doneTask = view.pool.doneTasks.find(t => t.id === id);
      return backpack.reopenTask(ctx, id, doneTask?.completionId ?? null, now(), makeRoom);
    }),
    completeItem: (cardId, finishEarly) => call(() => completeItem(ctx, cardId, now(), { finishEarly })),
    reopenItem: (cardId, makeRoom) => call(() => backpack.reopenTaskItem(ctx, cardId, now(), makeRoom)),
    checkCompleteItem: cardId => checkComplete(ctx, cardId, now()),
    saveCard: (cardId, fields) => call(() => backpack.saveCard(ctx, cardId, fields, now())),
    pass: cardId => call(() => pass(ctx, cardId, now())),
    convertIdea: (ideaId, input) => call(() => ideas.convertIdeaToTask(ctx, ideaId, input, now())),
    deleteIdea: ideaId => call(() => ideas.deleteIdea(ctx, ideaId, now())),
    completeIdea: (ideaId, text) => call(async () => {
      await ideas.complete(ctx, ideaId, now());
      onInfo?.(`已完成「${text.length > 16 ? text.slice(0, 15) + '…' : text}」`, '收进「已完成」；在那里可以撤销。');
    }),
    uncompleteIdea: ideaId => call(() => ideas.uncomplete(ctx, ideaId, now())),
    loadIdeaDetails: ideaId => ideas.getIdeaDetails(ctx, ideaId),
    updateIdea: input => ideas.updateIdea(ctx, input, now()),
    openIdeaWindow: onOpenIdeaWindow,
    onIdeaEditDirtyChange: onIdeaEditDirtyChange,
    createProject: name => call(() => preset.createProject(ctx, name, now())),
    createTag: tag => call(() => ctx.settings.lists.tags.includes(tag) ? Promise.resolve() : changeLists(ctx, { tags: [...ctx.settings.lists.tags, tag] }, now(), HOME)),
  };
  return <>
    <BagDrawer open={open} onClose={onClose} data={data} actions={actions}>{children}</BagDrawer>
    {flip && <FlipDeal key={flip.key} pick={flip.pick} pool={flip.pool} from={flip.from} onCancel={() => setFlip(null)}
      onStart={() => startFromBag(flip.pick.id, now())}
      onAgain={() => { const id = flip.pick.id; setFlip(null); call(async () => { await plan.skipCard(ctx, id, now()); draw(now()); }); }} />}
    {ask?.kind === 'plan' && <Dialog en="PLAN FIRST" title="今天还没排" onClose={() => setAsk(null)}
      footer={<><Button onClick={() => { setAsk(null); call(async () => { await plan.skipToday(ctx, now()); draw(now()); }); }}>这次先不排</Button>
        <Button tone="ink" autoFocus onClick={() => { setAsk(null); onOpen(); }}>去排今天</Button></>}>
      抽卡只从今日任务板里抽。花一分钟挑几项排进今天？
      <p className="ins-note" style={{ marginTop: 6 }}>选「这次先不排」就从整个背包抽，今天排进第一项之前都这样。</p>
    </Dialog>}
    {ask?.kind === 'carry' && <Dialog en="CARRIED" title="先确认带过来的" onClose={() => setAsk(null)}
      footer={<Button tone="ink" autoFocus onClick={() => setAsk(null)}>好</Button>}>
      从前一天带过来的几项还没确认。在今日任务板顶上选〔都带上〕或〔不带〕，然后再抽。
    </Dialog>}
    {ask?.kind === 'blocked' && <Dialog en="WAIT" title={ask.reason === 'inserting' ? '插入中不能抽卡' : '休息中不能抽卡'} onClose={() => setAsk(null)}
      footer={<Button tone="ink" autoFocus onClick={() => setAsk(null)}>好</Button>}>
      {ask.reason === 'inserting' ? '先回到任务，或者结束原任务，再抽下一张。' : '休息结束后再抽。'}
    </Dialog>}
    {ask?.kind === 'done' && <Dialog en="ALL DONE" title="今天板子上的都做完了" onClose={() => setAsk(null)}
      footer={<><Button onClick={() => setAsk(null)}>好</Button><Button tone="ink" autoFocus onClick={() => { setAsk(null); onOpen(); }}>再排几项</Button></>}>
      板子上没有能抽的了：都达成了，或者剩下的正在做。想接着做就再排几项进来。
    </Dialog>}
  </>;
}
