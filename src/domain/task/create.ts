import type { TaskDraft } from '../../shared/backpack';
import type { Settings } from '../../shared/settings';
import type { Card } from '../card/card';
import { createCard } from '../card/edit';
import type { Task } from './task';
import { putInBackpack } from './backpack';
import { itemCapacity } from './pool';

export function taskWithItems(draft: TaskDraft, tasks: Task[], cards: Card[], settings: Settings, at: string, id: () => string) {
  const name = draft.name.trim();
  if (!name) throw new Error('任务名不能为空');
  let task: Task = { id: id(), name, slot: '支线', slot_index: null, status: '冷藏', created_at: at,
    bet_ends_at: null, default_project: draft.defaultProject?.trim() || null };
  if (draft.slot !== '不在背包') task = putInBackpack(task, draft.slot, tasks, settings, at);
  // Undefined preserves the legacy dialog's empty-task workflow; N4 supplies an explicit list.
  const contents = draft.items === undefined ? [] : draft.items.length ? draft.items : [name];
  if (contents.length > itemCapacity(task, cards, settings)) throw new Error('主线任务事项已满');
  const order = Math.max(0, ...cards.map(card => card.order));
  const items = contents.map((content, index) => createCard(id(), { content, type: '结果卡', timeboxMinutes: null,
    blocking: false, dueAt: null, noShrink: false, taskId: task.id, project: null, tags: [] }, at, order + index + 1));
  return { task, items };
}
