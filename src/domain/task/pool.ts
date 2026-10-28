import type { Card } from '../card/card';
import type { Task } from './task';
import { inBackpack } from './task';

export interface PoolLimits { mainTasks: number; sideTasks: number; mainItems: number }
export function singleItemTask(card: Card): Task {
  return { id: `task-${card.id}`, name: card.content, slot: '支线', slot_index: null, status: '进行中',
    created_at: card.created_at, bet_ends_at: null, default_project: null };
}
export const activeItems = (cards: readonly Card[], taskId: string) => cards.filter(card => card.task_id === taskId && (card.status === '待做' || card.status === '进行中'));
export function canAddTask(tasks: readonly Task[], slot: '主线' | '支线', limits: PoolLimits): boolean {
  return tasks.filter(task => inBackpack(task) && task.slot === slot).length < (slot === '主线' ? limits.mainTasks : limits.sideTasks);
}
export function afterItem(task: Task, cards: readonly Card[]): Task {
  return task.slot === '支线' && task.status === '进行中' && activeItems(cards, task.id).length === 0 ? { ...task, status: '已完成' } : task;
}
export function itemCapacity(task: Task, cards: readonly Card[], limits: PoolLimits): number {
  return task.slot === '主线' ? limits.mainItems - activeItems(cards, task.id).length : Infinity;
}
export function replaceableSingle(task: Task, cards: readonly Card[], elapsed: (id: string) => number): Card | null {
  const items = activeItems(cards, task.id), only = items[0];
  return items.length === 1 && only.content.replace(/[[\]]/g, '') === task.name && only.status === '待做' && elapsed(only.id) === 0 ? only : null;
}
