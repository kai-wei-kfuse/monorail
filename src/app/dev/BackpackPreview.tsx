import { useEffect, useState } from 'react';
import { Frame, StatusBar } from '../../ui/frame/StatusBar';
import { TitleBar } from '../../ui/frame/TitleBar';
import { WindowButtons } from '../../ui/frame/WindowButtons';
import type { BackpackActions, BackpackTab } from '../../pages/backpack/BackpackPage';
import { BackpackPage } from '../../pages/backpack/BackpackPage';
import type { IdeaView, TaskView, QueueGroup } from '../../pages/backpack/types';
import { NEW_CARD } from '../../widgets/CardEditor';
import { BaselineMarks } from '../shell/BaselineMarks';

const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const TASKS: TaskView[] = [
  { id: 'p1', name: '找工作', slot: '主线', slotIndex: 1, status: '进行中', betEndsAt: ago(-12), openCards: 4 },
  { id: 'p2', name: '小游戏房间系统', slot: '支线', slotIndex: 2, status: '进行中', betEndsAt: null, openCards: 2 },
  { id: 'p3', name: '学日语', slot: '不在背包', slotIndex: null, status: '冷藏', betEndsAt: null, openCards: 6 },
];
const card = (id: string, content: string, over: Partial<typeof NEW_CARD> = {}, extra: Partial<QueueGroup['cards'][number]> = {}) =>
  ({ id, fields: { ...NEW_CARD, content, ...over }, status: '待做' as const, shrinkLevel: 0, skipCount: 0, progressNote: null, ...extra });
const QUEUE: QueueGroup[] = [
  { taskId: 'p1', name: '找工作', slotLabel: '主线 01', cards: [
    card('c1', '沿 [Python] 往下学 1 小时', { type: '时间盒卡', timeboxMinutes: 60, taskId: 'p1' }, { status: '进行中', progressNote: '看完装饰器' }),
    card('c2', '找 3 个 JD', { noShrink: true, taskId: 'p1' }),
    card('c3', '只改一段项目经历', { taskId: 'p1' }, { shrinkLevel: 1, skipCount: 2 }) ] },
  { taskId: 'p2', name: '小游戏房间系统', slotLabel: '支线 02', cards: [card('c4', '写下房间系统的接口设计', { taskId: 'p2' })] },
  { taskId: null, name: '支线 · 未归项目', slotLabel: '支', cards: [card('c5', '查一下几台服务器有没有被攻击', { blocking: true, dueAt: ago(-1) })] },
];
const IDEAS: IdeaView[] = [
  { id: 'i1', text: '用空闲服务器搞点自动化', tags: ['服务器'], needs: '空闲服务器', pool: '活跃池', createdAt: ago(20), lastTouchedAt: ago(20) },
  { id: 'i2', text: '把读过的 Agent 文章整理成一份对比表', tags: ['AI'], needs: '大量 token', pool: '活跃池', createdAt: ago(41), lastTouchedAt: ago(41) },
  { id: 'i3', text: '给打印机做个喷头清洁提醒', tags: [], needs: null, pool: '已转待办', createdAt: ago(3), lastTouchedAt: ago(1) },
];
const noop: BackpackActions = { createTask() {}, freezeTask() {}, abandonTask() {}, restoreTask() {}, saveCard() {}, passCard() {}, convertIdea() {}, deleteIdea() {} };
const TABS = [{ id: 'home', cn: '首页', en: 'HOME' }, { id: 'backpack', cn: '背包', en: 'BACKPACK' }, { id: 'review', cn: '回顾', en: 'REVIEW' }, { id: 'settings', cn: '设置', en: 'SETTINGS' }];

// ?full：支线只有 1 格，背包两格都满（看放回背包时的腾位交互）
const FULL = new URLSearchParams(location.search).has('full');

/** 背包页预览（只在开发时用）：?tab=tasks|queue|ideas，?o=task|card|idea|abandon|restore 打开对应对话框。 */
export function BackpackPreview({ tab: initial, overlay }: { tab: string; overlay: string | null }) {
  const [tab, setTab] = useState<BackpackTab>((['tasks', 'queue', 'ideas'].includes(initial) ? initial : 'tasks') as BackpackTab);
  useEffect(() => {
    // 用点击模拟打开对话框，走的是页面里真实的打开路径
    const pick = { task: '.bp-tools .sbtn.ink', card: '.ls-acts .sbtn', idea: '.ls-acts .sbtn.ink', abandon: '.slot-acts .sbtn.danger', restore: '.ls-acts .sbtn' }[overlay ?? ''];
    if (pick) setTimeout(() => document.querySelector<HTMLButtonElement>(pick)?.click(), 50);
  }, [overlay]);
  const title = <TitleBar name="单轨" tabs={TABS} active="backpack" onTab={() => {}}>
    <WindowButtons pinned={false} maximized={false} onPin={() => {}} onMinimize={() => {}} onMaximize={() => {}} onClose={() => {}} />
  </TitleBar>;
  return <Frame titleBar={title} statusBar={<StatusBar right={<BaselineMarks main side={false} />} />}>
    <BackpackPage tab={tab} onTab={setTab} tasks={TASKS} queue={QUEUE} ideas={IDEAS}
      mainSlots={1} sideSlots={FULL ? 1 : 2} ideaLimit={10} defaultTimebox={60} actions={noop} />
  </Frame>;
}
