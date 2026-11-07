import type { Card } from '../domain/card/card';
import type { Task } from '../domain/task/task';
import { inBackpack } from '../domain/task/task';
import { putInBackpack, leaveBackpack } from '../domain/task/backpack';
import { completeTaskMeta, reopenTaskMeta, verifyTaskReopen } from '../domain/task/complete';
import { canAddTask, itemCapacity, singleItemTask, replaceableSingle, afterItem } from '../domain/task/pool';
import { createCard, editCard, editCardContent, cardTiming } from '../domain/card/edit';
import { completeCardItem, releaseCard, reopenCardItem, restoreCardFromSnapshot } from '../domain/card/transitions';
import { taskWithItems } from '../domain/task/create';
import { activityDay } from '../domain/timeline/day';
import type { BackpackSlot, CardFields, MakeRoom, TaskDraft } from '../shared/backpack';
import type { HistorySource } from '../shared/history';
import type { Ctx, Transaction } from './commit';
import { run } from './commit';
import { refreshInTx } from './dealService';
import { openInTx, stopRefInTx, renameRefInTx, retagRefInTx, refElapsedInTx, insertStateInTx } from './tracking/api';

function findTask(tx: Transaction, id: string): Task {
  const task = tx.tasks.find(item => item.id === id);
  if (!task) throw new Error('TASK_NOT_FOUND：任务不存在');
  return task;
}

/** S2 局部计时保护：目标任务或腾位对象若包含正在插入等待的原卡或待确认起点的当前卡，在任何写操作前拒绝。 */
function assertTaskNotInterruptedInTx(tx: Transaction, taskId: string): void {
  const resume = tx.state.resume_entry_id ? tx.entries.find(e => e.id === tx.state.resume_entry_id) : undefined;
  if (insertStateInTx(tx)) {
    const awayCardId = resume?.card_id ?? tx.state.current_card;
    if (awayCardId && tx.cards.some(c => c.id === awayCardId && c.task_id === taskId)) {
      throw new Error('IN_AWAY_ACTIVITY：正在插入别的事，先回到任务或结束原任务');
    }
  }
  if (Boolean(tx.state.pending_id || tx.state.pending_at) && tx.state.current_card) {
    if (tx.cards.some(c => c.id === tx.state.current_card && c.task_id === taskId)) {
      throw new Error('PENDING_START_CONFIRMATION：关联卡片正在等待开始确认，请先确认或取消');
    }
  }
}

async function removeTaskInTx(tx: Transaction, id: string, status: '冷藏' | '已放弃'): Promise<void> {
  const task = findTask(tx, id);
  assertTaskNotInterruptedInTx(tx, id);
  const open = openInTx(tx), resume = tx.state.resume_entry_id ? tx.entries.find(e => e.id === tx.state.resume_entry_id) : undefined;
  tx.saveTask(leaveBackpack(task, status));
  for (const card of tx.cards.filter(item => item.task_id === id)) {
    if (card.status === '进行中' || open?.card_id === card.id || (open?.kind === '暂停' && resume?.card_id === card.id)) stopRefInTx(tx, card.id);
    if (status === '已放弃' && card.status !== '已完成' && card.status !== '已放弃') tx.saveCard({ ...card, status: '已放弃' });
    else if (status === '冷藏' && card.status === '进行中') tx.saveCard(releaseCard(card));
    if (tx.state.current_card === card.id) { tx.state.current_card = null; tx.state.home_mode = 'blank'; }
  }
}

async function makeRoomInTx(tx: Transaction, slot: TaskDraft['slot'], room: MakeRoom | null | undefined): Promise<void> {
  if (!room) return;
  const task = findTask(tx, room.id);
  if (slot === '不在背包' || !inBackpack(task) || task.slot !== slot) throw new Error('INVALID_MAKE_ROOM_TARGET：腾位项目必须在目标类型的背包格内');
  assertTaskNotInterruptedInTx(tx, room.id);
  await removeTaskInTx(tx, room.id, room.action === '放弃' ? '已放弃' : '冷藏');
}

export async function createTaskInTx(tx: Transaction, draft: TaskDraft): Promise<string> {
  await makeRoomInTx(tx, draft.slot, draft.makeRoom);
  const { task, items } = taskWithItems(draft, tx.tasks, tx.cards, tx.settings, tx.at, tx.id);
  tx.saveTask(task); items.forEach(item => tx.saveCard(item));
  refreshInTx(tx);
  return task.id;
}
export const createTask = (ctx: Ctx, draft: TaskDraft, at: string) => run(ctx, tx => createTaskInTx(tx, draft), at, { action: 'backpack.createTask' });

export const freezeTask = (ctx: Ctx, id: string, at: string) => run(ctx, async tx => {
  await removeTaskInTx(tx, id, '冷藏'); refreshInTx(tx);
}, at, { action: 'backpack.freezeTask' });
export const abandonTask = (ctx: Ctx, id: string, at: string) => run(ctx, async tx => {
  await removeTaskInTx(tx, id, '已放弃'); refreshInTx(tx);
}, at, { action: 'backpack.abandonTask' });
export async function restoreTaskInTx(tx: Transaction, id: string, slot: BackpackSlot, makeRoom?: MakeRoom): Promise<void> {
  const at = tx.at;
  const task = findTask(tx, id);
  if (task.status === '已完成') {
    if (slot !== task.slot) throw new Error('INVALID_MAKE_ROOM_TARGET：已完成任务只能恢复回原所属主线或支线槽位');
    await reopenTaskInTx(tx, { taskId: id, completionId: task.completion?.id ?? null, makeRoom });
    return;
  }
  if (makeRoom?.id === id) throw new Error('INVALID_MAKE_ROOM_TARGET：不能用当前项目给自己腾位');
  await makeRoomInTx(tx, slot, makeRoom);
  tx.saveTask(putInBackpack(task, slot, tx.tasks, tx.settings, at)); refreshInTx(tx);
}
export const restoreTask = (ctx: Ctx, id: string, slot: BackpackSlot, at: string, makeRoom?: MakeRoom) => run(ctx, tx => restoreTaskInTx(tx, id, slot, makeRoom), at, { action: 'backpack.restoreTask' });

export interface CompleteTaskResult {
  noop: boolean;
  task: Task;
  completionId: string | null;
  affectedCards: Card[];
}

export function completeTaskInTx(tx: Transaction, taskId: string): CompleteTaskResult {
  const task = findTask(tx, taskId);
  if (task.status === '已完成') {
    return { noop: true, task, completionId: task.completion?.id ?? null, affectedCards: [] };
  }
  if (!inBackpack(task)) {
    throw new Error('TASK_NOT_ACTIVE：只能完成背包中进行中的任务');
  }
  assertTaskNotInterruptedInTx(tx, taskId);
  if (tx.state.rest && tx.state.current_card && tx.cards.some(c => c.id === tx.state.current_card && c.task_id === taskId)) {
    throw new Error('IN_REST_MODE：正在休息，请先从休息返回');
  }

  const day = activityDay(tx.at, tx.settings.dayBoundaryHour);
  const completionId = tx.id();
  const plan = completeTaskMeta(task, tx.cards, completionId, tx.at, day);
  const open = openInTx(tx);
  const resume = tx.state.resume_entry_id ? tx.entries.find(e => e.id === tx.state.resume_entry_id) : undefined;
  const affectedCards: Card[] = [];

  for (const cardId of plan.affectedCardIds) {
    const card = tx.cards.find(item => item.id === cardId)!;
    if (card.status === '进行中' || open?.card_id === card.id || (open?.kind === '暂停' && resume?.card_id === card.id)) {
      stopRefInTx(tx, card.id);
    }
    if (tx.state.current_card === card.id) {
      tx.state.current_card = null;
      tx.state.home_mode = 'blank';
    }
    const done = completeCardItem(card, tx.at, day, plan.track);
    tx.saveCard(done);
    affectedCards.push(done);
  }
  for (const card of tx.cards.filter(item => item.task_id === taskId)) {
    if (tx.state.current_card === card.id) {
      tx.state.current_card = null;
      tx.state.home_mode = 'blank';
    }
  }

  tx.saveTask(plan.task);
  refreshInTx(tx);
  return { noop: false, task: plan.task, completionId, affectedCards };
}

export const completeTask = (ctx: Ctx, taskId: string, at: string, source?: HistorySource) => run(
  ctx,
  async tx => completeTaskInTx(tx, taskId),
  at,
  { action: 'backpack.completeTask', subject: { type: 'task', id: taskId }, ...(source ? { source } : {}) },
);

export interface ReopenTaskInput {
  taskId: string;
  completionId: string | null;
  makeRoom?: MakeRoom | null;
}
export interface ReopenTaskResult {
  noop: boolean;
  task: Task;
  reopenMode: 'snapshot' | 'task_only';
  restoredCards: Card[];
}

export async function reopenTaskInTx(tx: Transaction, input: ReopenTaskInput): Promise<ReopenTaskResult> {
  const task = findTask(tx, input.taskId);
  if (inBackpack(task)) {
    if (input.makeRoom) {
      throw new Error('MAKE_ROOM_NOT_NEEDED：任务已在背包进行中，无需腾位');
    }
    return { noop: true, task, reopenMode: 'task_only', restoredCards: [] };
  }
  if (task.status !== '已完成') {
    throw new Error('TASK_NOT_COMPLETED：只能重新打开已完成的任务');
  }
  const check = verifyTaskReopen(task, tx.cards, input.completionId);
  if (!check.ok) {
    if (check.reason === 'COMPLETION_ID_MISMATCH' || check.reason === 'NO_SNAPSHOT') {
      throw new Error(`COMPLETION_ID_MISMATCH：完成批次不匹配（${check.reason}），请先刷新任务详情获取最新 completion_id`);
    }
    throw new Error(`TASK_COMPLETION_CHANGED：任务或事项在完成后已被修改或试图绕过完成快照（${check.reason}${check.conflictCardIds.length ? `：${check.conflictCardIds.join(', ')}` : ''}），无法按该模式恢复`);
  }
  if (input.makeRoom?.id === task.id) {
    throw new Error('INVALID_MAKE_ROOM_TARGET：不能用当前任务给自己腾位');
  }
  if (!input.makeRoom && !canAddTask(tx.tasks, task.slot, tx.settings)) {
    throw new Error(`TASK_CAPACITY_FULL：${task.slot}背包格已满，请先选择要冷藏或放弃的同类别任务腾位`);
  }
  await makeRoomInTx(tx, task.slot, input.makeRoom);
  const placed = putInBackpack(task, task.slot, tx.tasks, tx.settings, tx.at);
  const reopenedTask = reopenTaskMeta(task, placed);
  tx.saveTask(reopenedTask);

  const restoredCards: Card[] = [];
  for (const snap of check.snapshots) {
    const card = tx.cards.find(item => item.id === snap.id)!;
    const restored = restoreCardFromSnapshot(card, snap.before);
    tx.saveCard(restored);
    restoredCards.push(restored);
  }
  refreshInTx(tx);
  return { noop: false, task: reopenedTask, reopenMode: check.mode, restoredCards };
}

export const reopenTask = (ctx: Ctx, taskId: string, completionId: string | null, at: string, makeRoom?: MakeRoom | null, source?: HistorySource) => run(
  ctx,
  tx => reopenTaskInTx(tx, { taskId, completionId, makeRoom }),
  at,
  { action: 'backpack.reopenTask', subject: { type: 'task', id: taskId }, ...(source ? { source } : {}) },
);

export interface ReopenTaskItemInput {
  cardId: string;
  makeRoom?: MakeRoom | null;
}
export interface ReopenTaskItemResult {
  noop: boolean;
  card: Card;
  task: Task | null;
  taskReopened: boolean;
}

export async function reopenTaskItemInTx(tx: Transaction, input: ReopenTaskItemInput): Promise<ReopenTaskItemResult> {
  const card = tx.cards.find(item => item.id === input.cardId);
  if (!card) throw new Error('CARD_NOT_FOUND：卡片不存在');
  const task = card.task_id !== null ? tx.tasks.find(item => item.id === card.task_id) ?? null : null;
  if (card.task_id !== null && !task) throw new Error('TASK_NOT_FOUND：任务不存在');
  if (task && (task.status === '冷藏' || task.status === '已放弃')) {
    throw new Error('TASK_NOT_REOPENABLE：所属任务已冷藏或已放弃，不能直接取消完成事项');
  }
  if (card.status === '待做') {
    if (input.makeRoom) {
      throw new Error('MAKE_ROOM_NOT_NEEDED：事项已是待做状态，无需腾位');
    }
    if (!task || inBackpack(task)) {
      return { noop: true, card, task, taskReopened: false };
    }
  }
  if (card.status !== '已完成') {
    throw new Error('CARD_NOT_COMPLETED：只有已完成的事项可以取消完成');
  }
  if (task && task.slot === '主线' && itemCapacity(task, tx.cards, tx.settings) <= 0) {
    throw new Error(`MAIN_TASK_ITEMS_FULL：主线任务待做事项已达上限（${tx.settings.mainItems} 项），请先完成或移出其他事项`);
  }
  if (!task || inBackpack(task)) {
    if (input.makeRoom) {
      throw new Error('MAKE_ROOM_NOT_NEEDED：所属任务已在背包进行中，无需腾位');
    }
    const reopenedCard = reopenCardItem(card);
    tx.saveCard(reopenedCard);
    refreshInTx(tx);
    return { noop: false, card: reopenedCard, task, taskReopened: false };
  }

  // 父任务处于已完成：同事务恢复父任务回原槽位并清空旧批量快照，仅恢复当前单个子项
  if (input.makeRoom?.id === task.id) {
    throw new Error('INVALID_MAKE_ROOM_TARGET：不能用当前任务给自己腾位');
  }
  if (!input.makeRoom && !canAddTask(tx.tasks, task.slot, tx.settings)) {
    throw new Error(`TASK_CAPACITY_FULL：${task.slot}背包格已满，请先选择要冷藏或放弃的同类别任务腾位`);
  }
  await makeRoomInTx(tx, task.slot, input.makeRoom);
  const placed = putInBackpack(task, task.slot, tx.tasks, tx.settings, tx.at);
  const reopenedTask = reopenTaskMeta(task, placed);
  tx.saveTask(reopenedTask);

  const reopenedCard = reopenCardItem(card);
  tx.saveCard(reopenedCard);
  refreshInTx(tx);
  return { noop: false, card: reopenedCard, task: reopenedTask, taskReopened: true };
}

export const reopenTaskItem = (ctx: Ctx, cardId: string, at: string, makeRoom?: MakeRoom | null, source?: HistorySource) => run(
  ctx,
  tx => reopenTaskItemInTx(tx, { cardId, makeRoom }),
  at,
  { action: 'card.reopen', subject: { type: 'card', id: cardId }, ...(source ? { source } : {}) },
);

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
}, at, { action: 'backpack.addItem' });
export const setDefaultProject = (ctx: Ctx, taskId: string, project: string | null, at: string) => run(ctx, async tx => {
  const task = findTask(tx, taskId), value = project?.trim() || null;
  tx.saveTask({ ...task, default_project: value });
  for (const card of tx.cards.filter(item => item.task_id === taskId && item.project === null)) retagRefInTx(tx, card.id, value ?? '未分类', card.tags);
}, at, { action: 'backpack.setDefaultProject' });

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
  if (original?.task_id && original.task_id !== card.task_id) tx.saveTask(afterItem(findTask(tx, original.task_id), tx.cards, tx.at));
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
}, at, { action: 'backpack.saveCard' });

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
}, at, { action: 'backpack.reorderQueue' });
