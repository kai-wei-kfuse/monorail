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
import { RestoreDialog, TaskDialog } from '../../../widgets/TaskDialog';
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
}

type Open = { kind: 'task'; slot: BackpackSlot } | { kind: 'card'; cardId: string } | { kind: 'idea'; idea: IdeaView }
  | { kind: 'deleteIdea'; idea: { id: string; text: string } } | { kind: 'abandon'; task: PoolTask } | { kind: 'restore'; task: { id: string; name: string } } | null;

/**
 * 背包抽屉（ADR 0021 第 2 条，UI 规范 §11.15，原型 bag-prototype.html v0.24）：从底栏〔背包〕往上滑出，占首页内容区 92%。
 * children 是首页的卡，抽屉开着时亮度 .91、缩放 .985，照常计时。Esc、〔收起〕、点上面露出的卡都收起；在抽屉里点〔开始〕后自动收起。
 */
export function BagDrawer({ open, onClose, data, actions, children }:
  { open: boolean; onClose: () => void; data: BagData; actions: BagActions; children: ReactNode }) {
  const [day, setDay] = useState<PlanDay>('today'), [tabPicked, setTab] = useState<'tasks' | 'ideas'>('tasks');
  const tab = data.taskMode ? tabPicked : 'ideas';
  const [detail, setDetail] = useState<string | null>(null), [coldOpen, setColdOpen] = useState(false);
  const [pop, setPop] = useState<{ item: PoolItem; task: PoolTask; anchor: HTMLElement } | null>(null), [dlg, setDlg] = useState<Open>(null);
  const [tick, setTick] = useState(() => Date.now()), drawer = useRef<HTMLDivElement>(null);
  const { pool, plan } = data, board = plan[day], days = { today: plan.today.day, tomorrow: plan.tomorrow.day };
  const all = [...pool.mains, ...pool.sides], task = detail ? all.find(t => t.id === detail) ?? null : null;

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
  const start = (cardId: string) => { actions.start(cardId); onClose(); };
  const planOf = (item: PoolItem, anchor: HTMLElement) => { const t = all.find(x => x.items.some(i => i.id === item.id)); if (t) setPop({ item, task: t, anchor }); };
  const unplan = (cardId: string) => actions.planRemove(day, cardId);
  const inBackpack: SlotTask[] = data.tasks.filter(p => p.status === '进行中' && p.slot !== '不在背包')
    .map(p => ({ id: p.id, name: p.name, slot: p.slot as BackpackSlot, slotIndex: p.slotIndex ?? 0 }));
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
          {task ? <QuestDetail task={task} day={day} board={board} days={days} inserting={data.inserting} onBack={() => setDetail(null)}
              onEdit={cardId => setDlg({ kind: 'card', cardId })} onPlan={planOf} onUnplan={unplan} onStart={start}
              onAdd={content => actions.addItem(task.id, content)} onFreeze={() => { actions.freezeTask(task.id); setDetail(null); }}
              onAbandon={() => setDlg({ kind: 'abandon', task })} />
            : <>
              <div className="bp-mhead">{data.taskMode ? <Segmented label="背包分页" value={tab} onChange={setTab}
                  options={[{ value: 'tasks', label: `任务 ${all.length}` }, { value: 'ideas', label: `想法池 ${data.ideas.filter(i => i.pool === '活跃池').length}` }]} />
                  : <span className="bp-sec" style={{ margin: 0 }}>想法池<i>IDEAS</i></span>}
                <span className="note">{tab === 'tasks' ? `点卡片看详情 · 卡上的〔排进${day === 'today' ? '今天' : '明天'}〕只排下一项` : data.taskMode ? '想到要做的事先放这里' : '任务模式关着：背包里只有想法池。在设置 02 打开任务模式，任务和今日任务板都会回来'}</span></div>
              {tab === 'tasks' ? <>
                <h3 className="bp-sec">主线任务<i>MAIN QUEST</i><small>{pool.mains.length} / {pool.mainMax} 个</small></h3>
                <div className="bp-grid">{pool.mains.map(card)}{pool.mains.length < pool.mainMax && newTile('主线', pool.mains.length)}</div>
                <h3 className="bp-sec">支线任务<i>SIDE QUEST</i><small>{pool.sides.length} / {pool.sideMax} 个</small></h3>
                <div className="bp-grid">{pool.sides.map(card)}{pool.sides.length < pool.sideMax && newTile('支线', pool.sides.length)}</div>
                {pool.parked.length > 0 && <div className="bp-cold" data-open={coldOpen ? '' : undefined}>
                  <button type="button" onClick={() => setColdOpen(!coldOpen)}><Icon name="chev" />冷藏<i>FROZEN</i><span className="bp-hint">{pool.parked.length} 个任务</span></button>
                  {coldOpen && <ul>{pool.parked.map(c => <li key={c.id}>{c.name}<small>{c.itemCount} 项</small>
                    <button type="button" className="bp-btn" onClick={() => setDlg({ kind: 'restore', task: c })}>解冻</button></li>)}</ul>}
                </div>}
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
  </div>;
}
