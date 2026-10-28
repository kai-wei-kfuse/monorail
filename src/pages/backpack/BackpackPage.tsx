import { useState } from 'react';
import { SideNav, SplitLayout } from '../../ui/layout/SideNav';
import { PanelHeader } from '../../ui/layout/PanelHeader';
import { Dialog } from '../../ui/overlay/Dialog';
import { Button } from '../../ui/controls/Button';
import { Emblem } from '../../ui/marks/Emblem';
import type { CardFields } from '../../widgets/CardEditor';
import { CardEditor } from '../../widgets/CardEditor';
import type { BackpackSlot, MakeRoom, TaskDraft } from '../../shared/backpack';
import type { SlotTask } from '../../widgets/TaskDialog';
import { TaskDialog } from '../../widgets/TaskDialog';
import { ConvertIdea } from '../../widgets/ConvertIdea';
import { TaskPool } from './TaskPool';
import type { PoolView } from './TaskPool';
import { IdeaPool } from './IdeaPool';
import type { IdeaView, TaskView, QueueGroup } from './types';

export type BackpackTab = 'pool' | 'ideas';

export interface BackpackActions {
  createTask: (draft: TaskDraft, at: string) => void;
  addItem: (taskId: string, content: string, at: string) => void;
  setDefaultProject: (taskId: string, project: string, at: string) => void;
  freezeTask: (id: string, at: string) => void;
  abandonTask: (id: string, at: string) => void;
  /** 放回：用户选主线还是支线；那一边满了时带上腾位的选择。 */
  restoreTask: (id: string, slot: BackpackSlot, at: string, makeRoom?: MakeRoom) => void;
  saveCard: (cardId: string | null, fields: CardFields, at: string) => void;
  passCard: (cardId: string, at: string) => void;
  convertIdea: (ideaId: string, r: { content: string; taskId: string | null; at: string }) => void;
  deleteIdea: (ideaId: string, at: string) => void;
  createProject: (name: string, at: string) => void;
  createTag: (tag: string, at: string) => void;
}

type Open =
  | { kind: 'task'; slot: BackpackSlot }
  | { kind: 'card'; cardId: string }
  | { kind: 'idea'; idea: IdeaView }
  | { kind: 'delete'; idea: IdeaView }
  | null;

const HEAD = {
  pool: ['01', 'TASK POOL', '任务池', '要做的事都在这里，分主线任务和支线任务。首页抽到的卡，就是任务下面的事项。每个任务可以设「计时记到」哪个项目。点事项可以编辑。'],
  ideas: ['02', 'IDEAS', '想法池', '想法不出现在首页。约 60 天没动过就自动进冷库，不是删除，随时可以捞回来。'],
} as const;

/**
 * 背包页（方案 §7.5）：左侧分页（任务池 / 想法池），右侧内容；编辑类对话框都在这里打开。
 * 任务池的数据是 store 的 backpack.pool；编辑事项要的完整字段从 queue 里按卡 id 找。
 */
export function BackpackPage({ tab, onTab, pool, tasks, queue, ideas, knownTags, ideaLimit, defaultTimebox, actions }:
  { tab: BackpackTab; onTab: (tab: BackpackTab) => void; pool: PoolView; tasks: TaskView[]; queue: QueueGroup[]; ideas: IdeaView[];
    knownTags: string[]; ideaLimit: number; defaultTimebox: number; actions: BackpackActions }) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null), at = () => new Date().toISOString();
  const inBackpack: SlotTask[] = tasks.filter(p => p.status === '进行中' && p.slot !== '不在背包')
    .map(p => ({ id: p.id, name: p.name, slot: p.slot as BackpackSlot, slotIndex: p.slotIndex ?? 0 }));
  const poolTasks = [...pool.mains, ...pool.sides], choices = poolTasks.map(t => ({ id: t.id, name: t.name, defaultProject: t.defaultProject }));
  const editing = open?.kind === 'card' ? queue.flatMap(g => g.cards).find(c => c.id === open.cardId) : undefined;
  const activeIdeas = ideas.filter(i => i.pool === '活跃池').length;
  const nav = [
    { id: 'pool', no: '01', cn: '任务池', en: 'TASK POOL', count: poolTasks.length },
    { id: 'ideas', no: '02', cn: '想法池', en: 'IDEAS', count: activeIdeas },
  ];
  const head = HEAD[tab];
  return <>
    <SplitLayout nav={<SideNav en="BACKPACK" cn="背包" items={nav} active={tab} onSelect={id => onTab(id as BackpackTab)}
      foot={<><Emblem /><div><b>背包</b><span>{poolTasks.length} / {pool.mainMax + pool.sideMax} TASKS</span></div></>} />}>
      <PanelHeader no={head[0]} en={head[1]} cn={head[2]} desc={head[3]} />
      {tab === 'pool' && <TaskPool view={pool} actions={{
        newTask: slot => setOpen({ kind: 'task', slot }),
        editItem: cardId => setOpen({ kind: 'card', cardId }),
        addItem: (id, content) => actions.addItem(id, content, at()),
        setDefaultProject: (id, project) => actions.setDefaultProject(id, project, at()),
        freeze: id => actions.freezeTask(id, at()),
        abandon: id => actions.abandonTask(id, at()),
        restore: (id, slot) => actions.restoreTask(id, slot, at()),
        createProject: name => actions.createProject(name, at()),
      }} />}
      {tab === 'ideas' && <IdeaPool ideas={ideas} limit={ideaLimit} onConvert={idea => setOpen({ kind: 'idea', idea })} onDelete={idea => setOpen({ kind: 'delete', idea })} />}
    </SplitLayout>

    {open?.kind === 'task' && <TaskDialog mode="new" initialSlot={open.slot} inBackpack={inBackpack}
      mainFree={pool.mains.length < pool.mainMax} sideFree={pool.sides.length < pool.sideMax} mainItems={pool.mainItems}
      projects={pool.projects} onCreateProject={name => actions.createProject(name, at())}
      onCancel={close} onSave={(draft, when) => { close(); actions.createTask(draft, when); }} />}
    {open?.kind === 'card' && editing && <CardEditor isNew={false} tasks={choices} defaultTimebox={defaultTimebox}
      initial={editing.fields} passBlocked={editing.passBlocked} projects={pool.projects} knownTags={knownTags}
      onCreateProject={name => actions.createProject(name, at())} onCreateTag={tag => actions.createTag(tag, at())}
      onCancel={close} onSave={(fields, when) => { close(); actions.saveCard(editing.id, fields, when); }}
      onPass={when => { close(); actions.passCard(editing.id, when); }} />}
    {open?.kind === 'idea' && <ConvertIdea ideaText={open.idea.text} tasks={choices} onCancel={close}
      onConvert={r => { close(); actions.convertIdea(open.idea.id, r); }} />}
    {open?.kind === 'delete' && <Dialog en="DELETE" title="删除这个想法" onClose={close}
      footer={<><Button onClick={close}>算了</Button><Button tone="danger" onClick={() => { close(); actions.deleteIdea(open.idea.id, at()); }}>删除</Button></>}>
      想法平时不会被真正删除，过期只会进冷库。确定要永久删除「{open.idea.text.slice(0, 40)}」吗？
    </Dialog>}
  </>;
}
