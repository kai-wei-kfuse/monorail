import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PoolItem, PoolTask, PoolView } from '../../../store/backpackSlice';
import type { PlanSlice } from '../../../store/planSlice';
import { Segmented } from '../../../ui/controls/Segmented';
import { Button } from '../../../ui/controls/Button';
import { Dialog } from '../../../ui/overlay/Dialog';
import { Icon } from '../../../ui/icons/Icon';
import { plainText } from '../../../ui/marks/MarkedText';
import { formatReadout } from '../../../shared/duration';
import type { BackpackSlot, MakeRoom, TaskDraft } from '../../../shared/backpack';
import type { CardFields } from '../../../widgets/CardEditor';
import { CardEditor } from '../../../widgets/CardEditor';
import type { SlotTask } from '../../../widgets/TaskDialog';
import { MakeRoomPicker, RestoreDialog, TaskDialog } from '../../../widgets/TaskDialog';
import { ConvertIdea } from '../../../widgets/ConvertIdea';
import type { IdeaTaskInput } from '../../../services/ideaService';
import { TodayBoard } from './TodayBoard';
import type { PlanDay } from './TodayBoard';
import { QuestCard, QuestDetail, dueLabel } from './QuestCard';
import { PlanPopover } from './PlanPopover';
import { IdeaPool } from './IdeaPool';
import type { DoneIdeaView, IdeaView, QueueGroup, TaskView } from './types';
import './drawer.css';

export interface BagActions {
  planAdd: (day: PlanDay, cardId: string, priority: '普通' | '高', todayMinutes: number | null) => void;
  planRemove: (day: PlanDay, cardId: string) => void;
  confirmCarry: (keep: string[]) => void;
  /** 〔开始〕：开始这一张卡；在抽屉里点了以后抽屉收起（原型 closeOnStart） */
  start: (cardId: string) => void;
  /** 〔抽一张〕：翻卡由外面演（首页舞台） */
  draw: () => void;
  createTask: (draft: TaskDraft) => void;
  addItem: (taskId: string, content: string) => void;
  freezeTask: (id: string) => void;
  abandonTask: (id: string) => void;
  restoreTask: (id: string, slot: BackpackSlot, makeRoom?: MakeRoom) => void;
  completeTask?: (id: string) => void;
  reopenTask?: (id: string, makeRoom?: MakeRoom | null) => void;
  completeItem?: (cardId: string, finishEarly?: boolean) => void;
  reopenItem?: (cardId: string, makeRoom?: MakeRoom | null) => void;
  checkCompleteItem?: (cardId: string) => Promise<{ remainingMinutes: number; at: string } | undefined>;
  saveCard: (cardId: string, fields: CardFields) => void;
  /** 编辑器里的〔PASS〕（同 0.3.0 背包页） */
  pass: (cardId: string) => void;
  convertIdea: (ideaId: string, input: IdeaTaskInput) => void;
  deleteIdea: (ideaId: string) => void;
  completeIdea: (ideaId: string, text: string) => void;
  uncompleteIdea: (ideaId: string) => void;
  createProject: (name: string) => void;
  createTag: (tag: string) => void;
}
export interface BagData {
  pool: PoolView; tasks: TaskView[]; queue: QueueGroup[]; ideas: IdeaView[]; doneIdeas: DoneIdeaView[];
  plan: PlanSlice; ideaLimit: number; defaultTimebox: number; knownTags: string[];
  /** 板子上能抽的项数（不含正在做的、已达成的、待确认的带过来项） */ drawable: number;
  /** 正在计的那一项（抽屉顶边） */ now: { title: string; startedAt: string } | null;
  /** 任务模式（设置 02）：关掉时抽屉只剩想法池页，没有今日任务板（ADR 0021 第 10 条） */ taskMode: boolean;
  inserting: boolean;
  /** 插入等待的原卡 ID（仅禁用该卡与所属任务的完成/腾位，不禁用其他任务） */ interruptedCardId?: string | null;
  /** 待确认计时关联的当前卡 ID（仅禁用该卡与所属任务的完成/腾位） */ pendingCardId?: string | null;
  /** 当前首页正在计时或已暂停的卡 ID（用于判断时间盒是否需要提前完成确认） */ activeOrPausedCardId?: string | null;
}

type Open = { kind: 'task'; slot: BackpackSlot } | { kind: 'card'; cardId: string } | { kind: 'idea'; idea: IdeaView }
  | { kind: 'deleteIdea'; idea: { id: string; text: string } } | { kind: 'abandon'; task: PoolTask } | { kind: 'restore'; task: { id: string; name: string } }
  | { kind: 'completeTask'; task: PoolTask } | { kind: 'reopenTask'; task: PoolTask }
  | { kind: 'completeItemEarly'; task: PoolTask; item: PoolItem; remainingMinutes: number }
  | { kind: 'reopenItemFromDoneTask'; task: PoolTask; item: PoolItem }
  | null;

/**
 * 背包抽屉（ADR 0021 第 2 条，UI 规范 §11.15，原型 bag-prototype.html v0.24）：从底栏〔背包〕往上滑出，占首页内容区 92%。
 * children 是首页的卡，抽屉开着时亮度 .91、缩放 .985，照常计时。Esc、〔收起〕、点上面露出的卡都收起；在抽屉里点〔开始〕后自动收起。
 */
export function BagDrawer({ open, onClose, data, actions, children }:
  { open: boolean; onClose: () => void; data: BagData; actions: BagActions; children: ReactNode }) {
  const [day, setDay] = useState<PlanDay>('today'), [tabPicked, setTab] = useState<'tasks' | 'ideas'>('tasks'), [taskView, setTaskView] = useState<'active' | 'done'>('active');
  const tab = data.taskMode ? tabPicked : 'ideas';
  const [detail, setDetail] = useState<string | null>(null), [coldOpen, setColdOpen] = useState(false);
  const [pop, setPop] = useState<{ item: PoolItem; task: PoolTask; anchor: HTMLElement } | null>(null), [dlg, setDlg] = useState<Open>(null);
  const [room, setRoom] = useState<MakeRoom | null>(null);
  const [tick, setTick] = useState(() => Date.now()), drawer = useRef<HTMLDivElement>(null);
  const { pool, plan } = data, board = plan[day], days = { today: plan.today.day, tomorrow: plan.tomorrow.day };
  const all = [...pool.mains, ...pool.sides], doneTasks = pool.doneTasks ?? [];
  const allWithDone = [...all, ...doneTasks], task = detail ? allWithDone.find(t => t.id === detail) ?? null : null;

  useEffect(() => { if (!open) { setPop(null); return; } const t = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(t); }, [open]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || dlg || pop || e.defaultPrevented) return;
      if (detail) { setDetail(null); return; }
      onClose();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [open, dlg, pop, detail, onClose]);

  // 正在计那一行：提交之后又过去的时间（G7 审核 S1）
  const runningMs = (() => { const run = plan.today.rows.find(r => r.running && r.runningSince); return run?.asOf ? Math.max(0, tick - Date.parse(run.asOf)) : 0; })();
  const start = (cardId: string) => { actions.start(cardId); };
  const planOf = (item: PoolItem, anchor: HTMLElement) => { const t = all.find(x => x.items.some(i => i.id === item.id)); if (t) setPop({ item, task: t, anchor }); };
  const unplan = (cardId: string) => actions.planRemove(day, cardId);
  const inBackpack: SlotTask[] = data.tasks.filter(p => p.status === '进行中' && p.slot !== '不在背包')
    .map(p => ({ id: p.id, name: p.name, slot: p.slot as BackpackSlot, slotIndex: p.slotIndex ?? 0 }));
  const taskHasInterruptedCard = (t: PoolTask) => Boolean(data.interruptedCardId && [...t.items, ...(t.doneItems ?? [])].some(i => i.id === data.interruptedCardId));
  const taskHasPendingCard = (t: PoolTask) => Boolean(data.pendingCardId && [...t.items, ...(t.doneItems ?? [])].some(i => i.id === data.pendingCardId));
  const completeTaskBlockedOf = (t: PoolTask): string | null =>
    taskHasInterruptedCard(t) ? '插入中不能操作被暂停的原任务，请先回到任务或结束原任务'
      : taskHasPendingCard(t) ? '当前事项存在待确认的开始计时，请先确认或放弃' : null;
  const completeItemBlockedOf = (it: PoolItem): string | null =>
    data.interruptedCardId === it.id ? '插入中不能完成被暂停的原事项，请先回到任务或结束原任务'
      : data.pendingCardId === it.id ? '当前事项存在待确认的开始计时，请先确认或放弃' : null;
  const reopenItemBlockedOf = (t: PoolTask, it: PoolItem): string | null => {
    if (!it.done) return null;
    if (t.track === '主线' && t.items.length >= pool.mainItems) return `主线任务最多同时有 ${pool.mainItems} 个待做子任务`;
    return null;
  };
  const reopenTaskBlockedOf = (t: PoolTask): string | null =>
    t.reopenConflictReason === 'conflict' ? '完成快照与当前子任务状态冲突，请进入详情单独恢复子项' : null;
  const roomCandidates = (slot: BackpackSlot) => inBackpack.filter(p => p.slot === slot && !all.find(t => t.id === p.id && (taskHasInterruptedCard(t) || taskHasPendingCard(t))));
  const handleCompleteItem = (t: PoolTask, it: PoolItem) => {
    if (completeItemBlockedOf(it)) return;
    if (it.type === '时间盒卡' && data.activeOrPausedCardId === it.id && actions.checkCompleteItem) {
      void actions.checkCompleteItem(it.id).then(check => {
        if (check && check.remainingMinutes > 0) setDlg({ kind: 'completeItemEarly', task: t, item: it, remainingMinutes: Math.ceil(check.remainingMinutes) });
        else actions.completeItem?.(it.id, false);
      });
      return;
    }
    actions.completeItem?.(it.id, false);
  };
  const handleReopenItem = (t: PoolTask, it: PoolItem) => {
    if (reopenItemBlockedOf(t, it)) return;
    if (t.status === '已完成') {
      setRoom(null);
      setDlg({ kind: 'reopenItemFromDoneTask', task: t, item: it });
      return;
    }
    actions.reopenItem?.(it.id);
  };
  const editing = dlg?.kind === 'card' ? data.queue.flatMap(g => g.cards).find(c => c.id === dlg.cardId) : undefined;
  const choices = all.map(t => ({ id: t.id, name: t.name, defaultProject: t.defaultProject }));
  const newTile = (slot: BackpackSlot, n: number) => <button type="button" className="bq-new" onClick={() => setDlg({ kind: 'task', slot })}>
    <span className="qi"><Icon name="plus" /></span><b>{slot === '主线' ? (n ? '再设一个主线任务' : '设定主线任务') : '新建支线任务'}</b><i>{slot === '主线' ? 'NEW MAIN' : 'NEW SIDE'}</i></button>;
  const card = (t: PoolTask) => <QuestCard key={t.id} task={t} day={day} board={board} days={days} inserting={data.inserting}
    onOpen={() => setDetail(t.id)} onPlan={planOf} onUnplan={unplan} onStart={start} />;
  const nowText = data.now ? formatReadout(Math.max(0, tick - Date.parse(data.now.startedAt)), 'mmss') : '';

  return <div className="bp-host" data-open={open ? '' : undefined}>
    <div className="bp-under" onPointerDown={open ? () => onClose() : undefined}>{children}</div>
    <div ref={drawer} className="bp-drawer" data-open={open ? '' : undefined} role="dialog" aria-label="背包" aria-hidden={!open}>
      <div className="bp-head">
        <span className="bp-tag"><b>背包</b><i>BACKPACK</i></span>
        <span className={`bp-now${data.now ? '' : ' idle'}`}><i className="dot" />{data.now ? <><span>{plainText(data.now.title)}</span><b>{nowText}</b></> : <span>没有在做的事</span>}</span>
        <button type="button" className="bp-close" onClick={onClose}><kbd>ESC</kbd>收起<span className="chev"><Icon name="chev" /></span></button>
      </div>
      <div className="bp-body" data-ideas-only={data.taskMode ? undefined : ''}>
        {data.taskMode && <TodayBoard day={day} board={board} drawable={data.drawable} inserting={data.inserting} runningMs={runningMs}
          onDay={setDay} onStart={start} onRemove={unplan} onDraw={actions.draw} onCarry={actions.confirmCarry} />}
        <div className="bp-main">
          {task ? <QuestDetail task={task} day={day} board={board} days={days} inserting={data.inserting} mainItems={pool.mainItems}
              completeTaskBlocked={completeTaskBlockedOf(task)} reopenTaskBlocked={reopenTaskBlockedOf(task)}
              completeItemBlocked={completeItemBlockedOf} reopenItemBlocked={it => reopenItemBlockedOf(task, it)}
              onBack={() => setDetail(null)}
              onEdit={cardId => setDlg({ kind: 'card', cardId })} onPlan={planOf} onUnplan={unplan} onStart={start}
              onAdd={content => actions.addItem(task.id, content)}
              onCompleteItem={it => handleCompleteItem(task, it)}
              onReopenItem={it => handleReopenItem(task, it)}
              onCompleteTask={() => setDlg({ kind: 'completeTask', task })}
              onReopenTask={() => { setRoom(null); setDlg({ kind: 'reopenTask', task }); }}
              onFreeze={() => { actions.freezeTask(task.id); setDetail(null); }}
              onAbandon={() => setDlg({ kind: 'abandon', task })} />
            : <>
              <div className="bp-mhead">{data.taskMode ? <Segmented label="背包分页" value={tab} onChange={setTab}
                  options={[{ value: 'tasks', label: `任务 ${all.length}` }, { value: 'ideas', label: `想法池 ${data.ideas.filter(i => i.pool === '活跃池').length}` }]} />
                  : <span className="bp-sec" style={{ margin: 0 }}>想法池<i>IDEAS</i></span>}
                <span className="note">{tab === 'tasks' ? (taskView === 'done' ? '按完成时间从新到旧 · 可整张重新打开或进详情单选恢复子项' : `点卡片看详情 · 卡上的〔排进${day === 'today' ? '今天' : '明天'}〕只排下一项`) : data.taskMode ? '想到要做的事先放这里' : '任务模式关着：背包里只有想法池。在设置 02 打开任务模式，任务和今日任务板都会回来'}</span></div>
              {tab === 'tasks' ? <>
                <div className="bp-subtabs">
                  <Segmented label="任务状态" value={taskView} onChange={setTaskView}
                    options={[{ value: 'active', label: `进行中 ${all.length}` }, { value: 'done', label: `已完成 ${doneTasks.length}` }]} />
                </div>
                {taskView === 'active' ? <>
                  <h3 className="bp-sec">主线任务<i>MAIN QUEST</i><small>{pool.mains.length} / {pool.mainMax} 个</small></h3>
                  <div className="bp-grid">{pool.mains.map(card)}{pool.mains.length < pool.mainMax && newTile('主线', pool.mains.length)}</div>
                  <h3 className="bp-sec">支线任务<i>SIDE QUEST</i><small>{pool.sides.length} / {pool.sideMax} 个</small></h3>
                  <div className="bp-grid">{pool.sides.map(card)}{pool.sides.length < pool.sideMax && newTile('支线', pool.sides.length)}</div>
                  {pool.parked.length > 0 && <div className="bp-cold" data-open={coldOpen ? '' : undefined}>
                    <button type="button" onClick={() => setColdOpen(!coldOpen)}><Icon name="chev" />冷藏<i>FROZEN</i><span className="bp-hint">{pool.parked.length} 个任务</span></button>
                    {coldOpen && <ul>{pool.parked.map(c => <li key={c.id}>{c.name}<small>{c.itemCount} 项</small>
                      <button type="button" className="bp-btn" onClick={() => setDlg({ kind: 'restore', task: c })}>解冻</button></li>)}</ul>}
                  </div>}
                </> : <>
                  {doneTasks.length === 0 ? <div className="bp-empty"><b>还没有已完成的任务</b>主线和支线完成后都会收进这里，不占背包格。</div>
                    : <div className="bp-done-list">{doneTasks.map(t => {
                        const totalCount = (t.doneItems?.length ?? 0) + t.items.length;
                        const doneCount = t.doneItems?.length ?? 0;
                        const timeText = t.completedAt ? `完成于 ${t.completedAt.slice(0, 16).replace('T', ' ')}` : '完成时间未记录';
                        const modeText = t.reopenConflictReason ? ' · 快照冲突' : t.reopenMode === 'task_only' ? ' · 自动/旧完成' : '';
                        const betText = t.track === '主线' && t.betEndsAt ? ` · 押注到 ${t.betEndsAt.slice(5).replace('-', '/')}` : '';
                        const reopenErr = reopenTaskBlockedOf(t);
                        return <article key={t.id} className="bp-done-row" tabIndex={0} onClick={() => setDetail(t.id)}
                          onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) setDetail(t.id); }}>
                          <div className="bp-done-main">
                            <h4><span className="bp-done-mk"><Icon name="check" /></span>{t.name}</h4>
                            <small><span className="bp-done-tag">{t.track}</span>{timeText} · {doneCount}/{totalCount} 项{betText}{modeText}</small>
                          </div>
                          <div className="bp-done-acts" onClick={e => e.stopPropagation()}>
                            <button type="button" className="bp-btn" onClick={() => setDetail(t.id)}>详情 ›</button>
                            <button type="button" className="bp-btn" disabled={Boolean(reopenErr)} title={reopenErr ?? '重新打开整张任务'}
                              onClick={() => { setRoom(null); setDlg({ kind: 'reopenTask', task: t }); }}>重新打开</button>
                          </div>
                        </article>;
                      })}</div>}
                  <p className="bp-done-note">主线和支线完成后都收到这里，不占背包格。可点「重新打开」恢复本批事项，或进「详情 ›」单独取消完成某一项。</p>
                </>}
              </> : <IdeaPool ideas={data.ideas} done={data.doneIdeas} limit={data.ideaLimit} onConvert={idea => setDlg({ kind: 'idea', idea })}
                onDelete={idea => setDlg({ kind: 'deleteIdea', idea })} onComplete={idea => actions.completeIdea(idea.id, idea.text)} onUncomplete={idea => actions.uncompleteIdea(idea.id)} />}
            </>}
        </div>
      </div>
      {pop && drawer.current && <PlanPopover item={pop.item} taskName={pop.task.items.length + (pop.task.doneItems?.length ?? 0) > 1 ? pop.task.name : null} day={day}
        due={!!dueLabel(pop.item, days) && dueLabel(pop.item, days).startsWith(day === 'today' ? '今天' : '明天')} anchor={pop.anchor} host={drawer.current}
        onCancel={() => setPop(null)} onConfirm={(priority, minutes) => { actions.planAdd(day, pop.item.id, priority, minutes); setPop(null); }} />}
    </div>

    {dlg?.kind === 'task' && <TaskDialog mode="new" initialSlot={dlg.slot} inBackpack={inBackpack}
      mainFree={pool.mains.length < pool.mainMax} sideFree={pool.sides.length < pool.sideMax} mainItems={pool.mainItems} defaultMinutes={data.defaultTimebox}
      projects={pool.projects} onCreateProject={actions.createProject} onCancel={() => setDlg(null)} onSave={draft => { setDlg(null); actions.createTask(draft); }} />}
    {dlg?.kind === 'card' && editing && <CardEditor isNew={false} tasks={choices} defaultTimebox={data.defaultTimebox}
      initial={editing.fields} passBlocked={editing.passBlocked} projects={pool.projects} knownTags={data.knownTags}
      onCreateProject={actions.createProject} onCreateTag={actions.createTag} onCancel={() => setDlg(null)}
      onSave={fields => { setDlg(null); actions.saveCard(editing.id, fields); }} onPass={() => { setDlg(null); actions.pass(editing.id); }} />}
    {dlg?.kind === 'idea' && <ConvertIdea ideaText={dlg.idea.text} mains={pool.mains.map(t => ({ id: t.id, name: t.name, room: pool.mainItems - t.items.length }))}
      mainFree={pool.mains.length < pool.mainMax} sideFree={pool.sides.length < pool.sideMax} mainItems={pool.mainItems}
      projects={pool.projects} onCreateProject={actions.createProject} onCancel={() => setDlg(null)}
      onConvert={input => { setDlg(null); actions.convertIdea(dlg.idea.id, input); }} />}
    {dlg?.kind === 'deleteIdea' && <Dialog en="DELETE" title="删除这个想法" onClose={() => setDlg(null)}
      footer={<><Button onClick={() => setDlg(null)}>算了</Button><Button tone="danger" onClick={() => { setDlg(null); actions.deleteIdea(dlg.idea.id); }}>删除</Button></>}>
      想法平时不会被真正删除，过期只会进冷库。确定要永久删除「{dlg.idea.text.slice(0, 40)}」吗？
    </Dialog>}
    {dlg?.kind === 'abandon' && <Dialog en="ABANDON" title={`放弃「${dlg.task.name}」？`} onClose={() => setDlg(null)}
      footer={<><Button onClick={() => setDlg(null)}>算了</Button><Button tone="danger" onClick={() => { const id = dlg.task.id; setDlg(null); setDetail(null); actions.abandonTask(id); }}>放弃</Button></>}>
      这个任务和它下面没做完的项都不再出现在背包里；排在板子上的项也不再显示。已经计的时间照常留着。
    </Dialog>}
    {dlg?.kind === 'restore' && <RestoreDialog task={dlg.task} inBackpack={inBackpack} mainFree={pool.mains.length < pool.mainMax} sideFree={pool.sides.length < pool.sideMax}
      onCancel={() => setDlg(null)} onRestore={(slot, _at, room) => { const id = dlg.task.id; setDlg(null); actions.restoreTask(id, slot, room); }} />}
    {dlg?.kind === 'completeTask' && (() => {
      const t = dlg.task, rem = t.items.length, doneCount = t.doneItems?.length ?? 0;
      const betText = t.track === '主线' && t.betEndsAt ? ` · 押注到 ${t.betEndsAt.slice(5).replace('-', '/')}` : '';
      return <Dialog en="COMPLETE QUEST" title={`完成「${t.name}」？`} onClose={() => setDlg(null)}
        footer={<><Button onClick={() => setDlg(null)}>取消</Button><Button tone="ink" onClick={() => { const id = t.id; setDlg(null); setDetail(null); setTaskView('done'); actions.completeTask?.(id); }}>完成整张任务</Button></>}>
        <div className="bp-summary"><b>{t.name}</b><small>{t.track} · 已完成 {doneCount} 项，还剩 {rem} 项{betText}</small></div>
        {rem > 0
          ? <><p>剩下的 <b>{rem} 项会一并完成</b>，任务将移到「已完成」，腾出一个{t.track}格。</p><p>正在计的这一项会停下；已记录的时间和进度笔记保留。</p></>
          : <p><b>全部 {doneCount} 项子任务已完成</b>，整张{t.track}任务将移到「已完成」，腾出一个{t.track}格。</p>}
      </Dialog>;
    })()}
    {dlg?.kind === 'reopenTask' && (() => {
      const t = dlg.task, slot: BackpackSlot = t.track === '主线' ? '主线' : '支线';
      const full = slot === '主线' ? pool.mains.length >= pool.mainMax : pool.sides.length >= pool.sideMax;
      const doneCount = t.doneItems?.length ?? 0, batchLen = t.reopenCardIds?.length ?? 0, keepLen = Math.max(0, doneCount - batchLen);
      const betText = t.track === '主线' && t.betEndsAt ? ` · 押注到 ${t.betEndsAt.slice(5).replace('-', '/')}` : '';
      const ok = !full || room !== null;
      return <Dialog en="REOPEN QUEST" title={`重新打开「${t.name}」？`} onClose={() => setDlg(null)}
        footer={<><Button onClick={() => setDlg(null)}>取消</Button><Button tone="ink" disabled={!ok}
          onClick={() => { const id = t.id, r = full ? room : null; setDlg(null); setTaskView('active'); actions.reopenTask?.(id, r); }}>{full ? '腾位并重新打开' : '重新打开'}</Button></>}>
        <div className="bp-summary"><b>{t.name}</b><small>{t.track} · {doneCount} 项已完成{betText}</small></div>
        {t.reopenMode === 'task_only'
          ? <><p>这项旧任务没有保存批量完成前的状态（或全部子项已逐个完成）。</p><p><b>只重新打开任务，{doneCount} 个已完成事项保持完成。</b>你可以继续添加新事项，不会自动开始计时。</p></>
          : <><p>本次一并完成的 <b>{batchLen} 项恢复为待做</b>{keepLen > 0 ? `，原先完成的 ${keepLen} 项保持完成` : ''}。</p>
              <p>原来进行中的事项也回到待做，<b>不会自动开始计时</b>。{t.track === '主线' && t.betEndsAt ? `押注日期仍是 ${t.betEndsAt.slice(5).replace('-', '/')}。` : ''}</p></>}
        {full && <MakeRoomPicker slot={slot} candidates={roomCandidates(slot)} value={room} onChange={setRoom} />}
      </Dialog>;
    })()}
    {dlg?.kind === 'completeItemEarly' && <Dialog en="COMPLETE ITEM" title={`提前完成「${plainText(dlg.item.content)}」？`} onClose={() => setDlg(null)}
      footer={<><Button onClick={() => setDlg(null)}>取消</Button><Button tone="ink" onClick={() => { const id = dlg.item.id; setDlg(null); actions.completeItem?.(id, true); }}>提前完成这一项</Button></>}>
      <p>只完成这一项，其他子任务保持原样。</p>
      <p>时间盒还差 <b>{dlg.remainingMinutes} 分钟</b>。确认后提前完成这一项，当前卡计时会停下。</p>
    </Dialog>}
    {dlg?.kind === 'reopenItemFromDoneTask' && (() => {
      const t = dlg.task, it = dlg.item, slot: BackpackSlot = t.track === '主线' ? '主线' : '支线';
      const full = slot === '主线' ? pool.mains.length >= pool.mainMax : pool.sides.length >= pool.sideMax;
      const otherDone = Math.max(0, (t.doneItems?.length ?? 1) - 1);
      const betText = t.track === '主线' && t.betEndsAt ? ` · 押注到 ${t.betEndsAt.slice(5).replace('-', '/')}` : '';
      const ok = !full || room !== null;
      return <Dialog en="REOPEN ITEM" title={`取消完成「${plainText(it.content)}」？`} onClose={() => setDlg(null)}
        footer={<><Button onClick={() => setDlg(null)}>取消</Button><Button tone="ink" disabled={!ok}
          onClick={() => { const id = it.id, r = full ? room : null; setDlg(null); actions.reopenItem?.(id, r); }}>{full ? '腾位并只恢复这一项' : '只恢复这一项'}</Button></>}>
        <div className="bp-summary"><b>{t.name} · {plainText(it.content)}</b><small>{t.track} · 已完成任务单子项恢复{betText}</small></div>
        <p><b>任务将一并回到背包，只将「{plainText(it.content)}」这一项恢复为待做</b>{otherDone > 0 ? `，其余 ${otherDone} 项已完成事项保持完成` : ''}。</p>
        <p>不会自动开始计时。{t.track === '主线' && t.betEndsAt ? `押注日期仍是 ${t.betEndsAt.slice(5).replace('-', '/')}。` : ''}</p>
        {full && <MakeRoomPicker slot={slot} candidates={roomCandidates(slot)} value={room} onChange={setRoom} />}
      </Dialog>;
    })()}
  </div>;
}
