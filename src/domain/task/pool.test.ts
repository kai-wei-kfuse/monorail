import { expect, it } from 'vitest';
import type { Task } from './task';
import { afterItem, canAddTask, itemCapacity, replaceableSingle } from './pool';
import { createCard } from '../card/edit';

const task: Task = { id: 't', name: 'task', slot: '支线', slot_index: null, status: '进行中', created_at: '2026-10-28T00:00:00Z', bet_ends_at: null, default_project: null };
const card = createCard('c', { content: 'task', type: '结果卡', timeboxMinutes: null, taskId: 't', blocking: false, noShrink: false, dueAt: null }, task.created_at, 1);
const limits = { mainTasks: 1, sideTasks: 10, mainItems: 5 };
it('capacity checks do not evict existing tasks when the configured maximum is lowered', () => {
  const tasks = Array.from({ length: 11 }, (_, index) => ({ ...task, id: String(index) }));
  expect(canAddTask(tasks, '支线', limits)).toBe(false);
  expect(tasks).toHaveLength(11);
  expect(canAddTask(tasks, '主线', limits)).toBe(true);
});
it('only a finished side task auto-completes; main tasks remain available for the next item', () => {
  expect(afterItem(task, [card]).status).toBe('进行中');
  expect(afterItem(task, [{ ...card, status: '已完成' }]).status).toBe('已完成');
  expect(afterItem({ ...task, slot: '主线' }, [{ ...card, status: '已完成' }]).status).toBe('进行中');
});
it('the first split may replace only a never-timed placeholder item', () => {
  expect(replaceableSingle(task, [card], () => 0)?.id).toBe('c');
  expect(replaceableSingle(task, [card], () => 1)).toBeNull();
  expect(replaceableSingle(task, [{ ...card, status: '进行中' }], () => 0)).toBeNull();
  expect(itemCapacity({ ...task, slot: '主线' }, [card], limits)).toBe(4);
});
