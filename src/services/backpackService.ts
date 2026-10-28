import type { Task } from '../domain/task/task';
import { inBackpack } from '../domain/task/task';
import { putInBackpack, leaveBackpack } from '../domain/task/backpack';
import { canAddTask, itemCapacity, singleItemTask, replaceableSingle, afterItem } from '../domain/task/pool';
import { createCard, editCard, editCardContent, cardTiming } from '../domain/card/edit';
import { releaseCard } from '../domain/card/transitions';
import { taskWithItems } from '../domain/task/create';
import type { BackpackSlot, CardFields, MakeRoom, TaskDraft } from '../shared/backpack';
import type { Ctx, Transaction } from './commit';
import { run } from './commit';
import { refreshInTx } from './dealService';
import { openInTx, stopRefInTx, renameRefInTx, retagRefInTx, refElapsedInTx } from './tracking/api';

function findTask(tx: Transaction, id: string): Task {
  const task = tx.tasks.find(item => item.id === id);
  if (!task) throw new Error('任务不存在');
  return task;
}

async function removeTaskInTx(tx: Transaction, id: string, status: '冷藏' | '已放弃'): Promise<void> {
  const task = findTask(tx, id);
  tx.saveTask(leaveBackpack(task, status));
  for (const card of tx.cards.filter(item => item.task_id === id)) {
    if (card.status === '进行中') stopRefInTx(tx, card.id);
    if (status === '已放弃' && card.status !== '已完成' && card.status !== '已放弃') tx.saveCard({ ...card, status: '已放弃' });
    else if (status === '冷藏' && card.status === '进行中') tx.saveCard(releaseCard(card));
    if (tx.state.current_card === card.id) { tx.state.current_card = null; tx.state.home_mode = 'blank'; }
  }
}

async function makeRoomInTx(tx: Transaction, slot: TaskDraft['slot'], room: MakeRoom | null | undefined): Promise<void> {
  if (!room) return;
  const task = findTask(tx, room.id);
  if (slot === '不在背包' || !inBackpack(task) || task.slot !== slot) throw new Error('腾位项目必须在目标类型的背包格内');
  await removeTaskInTx(tx, room.id, room.action === '放弃' ? '已放弃' : '冷藏');
}

export async function createTaskInTx(tx: Transaction, draft: TaskDraft): Promise<string> {
  await makeRoomInTx(tx, draft.slot, draft.makeRoom);
  const { task, items } = taskWithItems(draft, tx.tasks, tx.cards, tx.settings, tx.at, tx.id);
  tx.saveTask(task); items.forEach(item => tx.saveCard(item));
  refreshInTx(tx);
  return task.id;
}
export const createTask = (ctx: Ctx, draft: TaskDraft, at: string) => run(ctx, tx => createTaskInTx(tx, draft), at);

export const freezeTask = (ctx: Ctx, id: string, at: string) => run(ctx, async tx => {
  await removeTaskInTx(tx, id, '冷藏'); refreshInTx(tx);
}, at);
export const abandonTask = (ctx: Ctx, id: string, at: string) => run(ctx, async tx => {
  await removeTaskInTx(tx, id, '已放弃'); refreshInTx(tx);
}, at);
export async function restoreTaskInTx(tx: Transaction, id: string, slot: BackpackSlot, makeRoom?: MakeRoom): Promise<void> {
  const at = tx.at;
  const task = findTask(tx, id);
  if (makeRoom?.id === id) throw new Error('不能用当前项目给自己腾位');
  await makeRoomInTx(tx, slot, makeRoom);
  tx.saveTask(putInBackpack(task, slot, tx.tasks, tx.settings, at)); refreshInTx(tx);
}
export const restoreTask = (ctx: Ctx, id: string, slot: BackpackSlot, at: string, makeRoom?: MakeRoom) => run(ctx, tx => restoreTaskInTx(tx, id, slot, makeRoom), at);

export function addItemInTx(tx: Transaction, taskId: string, content: string): string {
  const task = findTask(tx, taskId);
  if (task.status === '已完成' || task.status === '已放弃') throw new Error('已结束的任务不能添加事项');
  const placeholder = replaceableSingle(task, tx.cards, id => refElapsedInTx(tx, id));
  if (placeholder) {
    tx.saveCard(editCardContent(placeholder, content));
    return placeholder.id;
  }
  if (itemCapacity(task, tx.cards, tx.settings) <= 0) throw new Error('主线任务事项已满');
  const card = createCard(tx.id(), { content, type: '结果卡', timeboxMinutes: null, blocking: false,
    dueAt: null, noShrink: false, taskId, project: null, tags: [] }, tx.at, Math.max(0, ...tx.cards.map(item => item.order)) + 1);
  tx.saveCard(card); return card.id;
}
export const addItem = (ctx: Ctx, taskId: string, content: string, at: string) => run(ctx, async tx => {
  const id = addItemInTx(tx, taskId, content); refreshInTx(tx); return id;
}, at);
export const setDefaultProject = (ctx: Ctx, taskId: string, project: string | null, at: string) => run(ctx, async tx => {
  const task = findTask(tx, taskId), value = project?.trim() || null;
  tx.saveTask({ ...task, default_project: value });
  for (const card of tx.cards.filter(item => item.task_id === taskId && item.project === null)) retagRefInTx(tx, card.id, value ?? '未分类', card.tags);
}, at);

export const saveCard = (ctx: Ctx, cardId: string | null, fields: CardFields, at: string) => run(ctx, async tx => {
  if (fields.taskId !== null) findTask(tx, fields.taskId);
  const original = cardId === null ? null : tx.cards.find(card => card.id === cardId);
  if (cardId !== null && !original) throw new Error('卡片不存在');
  if (original && original.status !== '待做' && original.status !== '进行中') throw new Error('只能编辑待做或进行中的卡');
  let card = original ? editCard(original, fields) : createCard(tx.id(), fields, at, Math.max(0, ...tx.cards.map(item => item.order)) + 1);
  if (!card.task_id) {
    if (!canAddTask(tx.tasks, '支线', tx.settings)) throw new Error('支线任务已满');
    const single = singleItemTask(card); tx.saveTask(single); card = { ...card, task_id: single.id };
  }
  const task = tx.tasks.find(item => item.id === card.task_id), current = openInTx(tx);
  if (task && original?.task_id !== task.id && itemCapacity(task, tx.cards, tx.settings) <= 0) throw new Error('主线任务事项已满');
  const eligible = card.task_id === null || (!!task && inBackpack(task));
  if (!eligible) {
    card = releaseCard(card);
    if (tx.state.current_card === card.id) tx.state.current_card = null;
  }
  tx.saveCard(card);
  if (original?.task_id && original.task_id !== card.task_id) tx.saveTask(afterItem(findTask(tx, original.task_id), tx.cards));
  if (current?.card_id === card.id) {
    if (!eligible) stopRefInTx(tx, card.id);
    else {
      renameRefInTx(tx, card.id, card.content.replace(/[[\]]/g, ''));
      const { project, tags } = cardTiming(card, task);
      retagRefInTx(tx, card.id, project, tags);
    }
  }
  refreshInTx(tx);
  return card.id;
}, at);

export const reorderQueue = (ctx: Ctx, taskId: string | null, cardIds: string[], at: string) => run(ctx, async tx => {
  if (taskId !== null) findTask(tx, taskId);
  const cards = tx.cards.filter(card => card.task_id === taskId && (card.status === '待做' || card.status === '进行中'));
  if (cardIds.length !== cards.length || new Set(cardIds).size !== cardIds.length || cards.some(card => !cardIds.includes(card.id))) throw new Error('队列已改变，请提交当前队列的完整顺序');
  const ordered = [...tx.cards].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  let index = 0;
  // Reassign ranks in the existing global sequence, replacing only this queue's positions.
  // This also makes ties in imported ranks reorderable without moving other tasks.
  const replacements = cardIds.map(id => cards.find(card => card.id === id)!);
  ordered.map(card => cardIds.includes(card.id) ? replacements[index++] : card)
    .forEach((card, rank) => { if (card.order !== rank + 1) tx.saveCard({ ...card, order: rank + 1 }); });
  refreshInTx(tx);
}, at);
