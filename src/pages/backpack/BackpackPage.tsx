import { useState } from 'react';
import { SideNav, SplitLayout } from '../../ui/layout/SideNav';
import { PanelHeader } from '../../ui/layout/PanelHeader';
import { Dialog } from '../../ui/overlay/Dialog';
import { Button } from '../../ui/controls/Button';
import { Emblem } from '../../ui/marks/Emblem';
import type { CardFields } from '../../widgets/CardEditor';
import { CardEditor, NEW_CARD } from '../../widgets/CardEditor';
import type { BackpackSlot, MakeRoom, TaskDraft } from '../../shared/backpack';
import type { SlotTask } from '../../widgets/TaskDialog';
import { TaskDialog, RestoreDialog } from '../../widgets/TaskDialog';
import { ConvertIdea } from '../../widgets/ConvertIdea';
import { TaskList } from './TaskList';
import { QueueList } from './QueueList';
import { IdeaPool } from './IdeaPool';
import type { IdeaView, TaskView, QueueCard, QueueGroup } from './types';

export type BackpackTab = 'tasks' | 'queue' | 'ideas';

export interface BackpackActions {
  createTask: (draft: TaskDraft, at: string) => void;
  freezeTask: (id: string, at: string) => void;
  abandonTask: (id: string, at: string) => void;
  /** 放回背包：用户选主线格还是支线格；那一格满了时带上腾位的选择。 */
  restoreTask: (id: string, slot: BackpackSlot, at: string, makeRoom?: MakeRoom) => void;
  saveCard: (cardId: string | null, fields: CardFields, at: string) => void;
  passCard: (cardId: string, at: string) => void;
  convertIdea: (ideaId: string, r: { content: string; taskId: string | null; at: string }) => void;
  deleteIdea: (ideaId: string, at: string) => void;
}

type Open =
  | { kind: 'task'; mode: 'new' | 'setMain' }
  | { kind: 'card'; card: QueueCard | null; taskId: string | null }
  | { kind: 'idea'; idea: IdeaView }
  | { kind: 'abandon'; task: TaskView }
  | { kind: 'restore'; task: TaskView }
  | { kind: 'delete'; idea: IdeaView }
  | null;

/** 背包页：左侧分页（项目 / 任务队列 / 想法池），右侧内容；编辑类对话框都在这里打开。 */
export function BackpackPage({ tab, onTab, tasks, queue, ideas, mainSlots, sideSlots, ideaLimit, defaultTimebox, actions }:
  { tab: BackpackTab; onTab: (tab: BackpackTab) => void; tasks: TaskView[]; queue: QueueGroup[]; ideas: IdeaView[];
    mainSlots: number; sideSlots: number; ideaLimit: number; defaultTimebox: number; actions: BackpackActions }) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const inBackpack: SlotTask[] = tasks.filter(p => p.status === '进行中' && p.slot !== '不在背包')
    .map(p => ({ id: p.id, name: p.name, slot: p.slot as '主线' | '支线', slotIndex: p.slotIndex ?? 0 }));
  const choices = inBackpack.map(p => ({ id: p.id, name: p.name }));
  const mainFree = inBackpack.filter(p => p.slot === '主线').length < mainSlots, sideFree = inBackpack.filter(p => p.slot === '支线').length < sideSlots;
  const activeIdeas = ideas.filter(i => i.pool === '活跃池').length;
  const nav = [
    { id: 'tasks', no: '01', cn: '项目', en: 'TASKS', count: inBackpack.length },
    { id: 'queue', no: '02', cn: '任务队列', en: 'QUEUE', count: queue.reduce((n, g) => n + g.cards.length, 0) },
    { id: 'ideas', no: '03', cn: '想法池', en: 'IDEAS', count: activeIdeas },
  ];
  const head = {
    tasks: ['01', 'TASKS', '项目', '格子里放的是项目，项目下面是任务队列，首页出的卡来自任务队列。背包满了还想开新坑，先把一个旧的冷藏或放弃。'],
    queue: ['02', 'QUEUE', '任务队列', '卡必须能明确判断是否完成：要么是一个具体结果，要么是一段计满的时间。"找工作"这种方向不能当卡。'],
    ideas: ['03', 'IDEAS', '想法池', '想法不出现在首页。约 60 天没动过就自动进冷库，不是删除，随时可以捞回来。'],
  }[tab];
  return <>
    <SplitLayout nav={<SideNav en="BACKPACK" cn="背包" items={nav} active={tab} onSelect={id => onTab(id as BackpackTab)}
      foot={<><Emblem /><div><b>背包</b><span>{inBackpack.length} / {mainSlots + sideSlots} SLOTS</span></div></>} />}>
      <PanelHeader no={head[0]} en={head[1]} cn={head[2]} desc={head[3]} />
      {tab === 'tasks' && <TaskList tasks={tasks} mainSlots={mainSlots} sideSlots={sideSlots}
        onNew={() => setOpen({ kind: 'task', mode: 'new' })} onSetMain={() => setOpen({ kind: 'task', mode: 'setMain' })}
        onFreeze={actions.freezeTask} onRestore={task => setOpen({ kind: 'restore', task })} onAbandon={task => setOpen({ kind: 'abandon', task })} />}
      {tab === 'queue' && <QueueList groups={queue} onEdit={card => setOpen({ kind: 'card', card, taskId: card.fields.taskId })}
        onAdd={taskId => setOpen({ kind: 'card', card: null, taskId })} />}
      {tab === 'ideas' && <IdeaPool ideas={ideas} limit={ideaLimit} onConvert={idea => setOpen({ kind: 'idea', idea })} onDelete={idea => setOpen({ kind: 'delete', idea })} />}
    </SplitLayout>

    {open?.kind === 'task' && <TaskDialog mode={open.mode} inBackpack={inBackpack}
      mainFree={mainFree} sideFree={sideFree}
      onCancel={close} onSave={(draft, at) => { close(); actions.createTask(draft, at); }} />}
    {open?.kind === 'restore' && <RestoreDialog task={open.task} inBackpack={inBackpack} mainFree={mainFree} sideFree={sideFree}
      onCancel={close} onRestore={(slot, at, makeRoom) => { close(); actions.restoreTask(open.task.id, slot, at, makeRoom); }} />}
    {open?.kind === 'card' && <CardEditor isNew={!open.card} tasks={choices} defaultTimebox={defaultTimebox}
      initial={open.card?.fields ?? { ...NEW_CARD, taskId: open.taskId }} passBlocked={open.card?.passBlocked}
      onCancel={close} onSave={(fields, at) => { close(); actions.saveCard(open.card?.id ?? null, fields, at); }}
      onPass={open.card ? at => { close(); actions.passCard(open.card!.id, at); } : undefined} />}
    {open?.kind === 'idea' && <ConvertIdea ideaText={open.idea.text} tasks={choices} onCancel={close}
      onConvert={r => { close(); actions.convertIdea(open.idea.id, r); }} />}
    {open?.kind === 'abandon' && <Dialog en="ABANDON" title={`放弃「${open.task.name}」`} onClose={close}
      footer={<><Button onClick={close}>算了</Button><Button tone="danger" onClick={() => { close(); actions.abandonTask(open.task.id, new Date().toISOString()); }}>放弃</Button></>}>
      项目移出背包，空出格号；它下面待做的 {open.task.openCards} 张卡全部改为已放弃。正在计时的会结束，回到待机。只是暂时不做的话，用「冷藏」。
    </Dialog>}
    {open?.kind === 'delete' && <Dialog en="DELETE" title="删除这个想法" onClose={close}
      footer={<><Button onClick={close}>算了</Button><Button tone="danger" onClick={() => { close(); actions.deleteIdea(open.idea.id, new Date().toISOString()); }}>删除</Button></>}>
      想法平时不会被真正删除，过期只会进冷库。确定要永久删除「{open.idea.text.slice(0, 40)}」吗？
    </Dialog>}
  </>;
}
