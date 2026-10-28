import { useState } from 'react';
import { PanelHeader } from '../../ui/layout/PanelHeader';
import { TaskPool } from '../../pages/backpack/TaskPool';
import type { PoolItem, PoolTask, PoolView } from '../../pages/backpack/TaskPool';
import { PREVIEW_PROJECTS } from './CalendarPreview';

const MIN = 60_000;
const item = (id: string, content: string, more: Partial<PoolItem> = {}): PoolItem => ({ id, content, type: '结果卡', timeboxMinutes: null, elapsedMs: 0,
  running: false, blocking: false, dueAt: null, shrinkLevel: 0, project: null, tags: [], ...more });

/**
 * 任务池预览（只在开发时用）：两个主线任务（一个满了）、两个支线任务（一个只有一项）、一个冷藏的。
 * 加事项、拆开、改计时项目、冷藏、放回、放弃直接改内存里的数据；第一次拆开只有一项的任务时，那一项换成拆出来的事（逻辑线的规则）。
 */
export function TaskPoolPreview() {
  const [projects, setProjects] = useState(PREVIEW_PROJECTS);
  const [log, setLog] = useState<string[]>([]);
  const [v, setV] = useState<Omit<PoolView, 'projects'>>(() => ({
    mainMax: 2, sideMax: 3, mainItems: 5, doneSides: ['买显示器'],
    mains: [
      { id: 'm1', name: '找到后端实习', track: '主线', defaultProject: '求职', items: [
        item('c1', '改 [简历] 第二版', { elapsedMs: 52 * MIN, running: true, tags: ['面试'] }),
        item('c2', '投 5 家公司', { type: '时间盒卡', timeboxMinutes: 60, dueAt: new Date(Date.now() + 2 * 86400_000).toISOString() }),
        item('c3', '刷 [LeetCode] 20 题', { shrinkLevel: 1, blocking: true }),
      ] },
      { id: 'm2', name: '考过 408', track: '主线', defaultProject: '学习',
        items: ['OS 第三章', 'OS 第四章', '计网 习题', '组成原理 复习', '数据结构 真题'].map((c, i) => item('d' + i, c, { elapsedMs: i * 17 * MIN })) },
    ],
    sides: [
      { id: 's1', name: '交水电费', track: '支线', defaultProject: '未分类', items: [item('e1', '交水电费', { dueAt: new Date(Date.now() + 86400_000).toISOString() })] },
      { id: 's2', name: '整理照片', track: '支线', defaultProject: '未分类', items: [item('e2', '导出手机相册'), item('e3', '删重复的')] },
    ],
    parked: [{ id: 'p1', name: '学日语 N2', track: '主线', itemCount: 3 }],
  }));
  const note = (s: string) => setLog(l => [...l, s]);
  const patchTask = (id: string, f: (t: PoolTask) => PoolTask) => setV(x => ({ ...x, mains: x.mains.map(t => t.id === id ? f(t) : t), sides: x.sides.map(t => t.id === id ? f(t) : t) }));
  const find = (id: string) => [...v.mains, ...v.sides].find(t => t.id === id)!;
  const park = (id: string) => setV(x => { const t = find(id); return { ...x, mains: x.mains.filter(y => y.id !== id), sides: x.sides.filter(y => y.id !== id),
    parked: [...x.parked, { id, name: t.name, track: t.track, itemCount: t.items.length }] }; });

  return <div style={{ padding: '24px 32px', maxWidth: 1100 }}>
    <PanelHeader no="01" en="TASK POOL" cn="任务池" desc="要做的事都在这里，分主线任务和支线任务。首页抽到的卡，就是任务下面的事项。每个任务可以设「计时记到」哪个项目。点事项可以编辑。" />
    <TaskPool view={{ ...v, projects }} actions={{
      newTask: track => note(`新建${track}任务`), editItem: id => note(`编辑事项 ${id}`),
      // 只有一项、而且就是任务本身的：第一次拆开时那一项换成拆出来的事
      addItem: (id, content) => patchTask(id, t => ({ ...t, items: t.items.length === 1 && t.items[0].content === t.name
        ? [{ ...t.items[0], content }] : [...t.items, item(crypto.randomUUID(), content)] })),
      setDefaultProject: (id, project) => patchTask(id, t => ({ ...t, defaultProject: project })),
      freeze: park, abandon: id => { const t = find(id); setV(x => ({ ...x, mains: x.mains.filter(y => y.id !== id), sides: x.sides.filter(y => y.id !== id) })); note(`放弃「${t.name}」`); },
      restore: (id, track) => setV(x => { const p = x.parked.find(t => t.id === id)!, back: PoolTask = { id, name: p.name, track, defaultProject: '未分类', items: [] };
        return { ...x, parked: x.parked.filter(t => t.id !== id), mains: track === '主线' ? [...x.mains, back] : x.mains, sides: track === '支线' ? [...x.sides, back] : x.sides }; }),
      createProject: name => setProjects(l => [...l, { name, color: '#16a085' }]),
    }} />
    <ol id="log" style={{ font: '330 12px/1.6 var(--f-cn)' }}>{log.map((s, i) => <li key={i}>{s}</li>)}</ol>
  </div>;
}
