import type { Task } from '../domain/task/task';
import { inBackpack, trackOf } from '../domain/task/task';
import { putInBackpack, leaveBackpack } from '../domain/task/backpack';
import { createCard, editCard } from '../domain/card/edit';
import { releaseCard } from '../domain/card/transitions';
import type { BackpackSlot, CardFields, MakeRoom, TaskDraft } from '../shared/backpack';
import type { Ctx, Transaction } from './commit';
import { run } from './commit';
import { refreshInTx } from './dealService';
import { openSegmentInTx, switchInTx, idleTarget } from './timerService';

function findTask(tx: Transaction, id: string): Task {
  const task = tx.tasks.find(item => item.id === id);
  if (!task) throw new Error('项目不存在');
  return task;
}

async function removeTaskInTx(tx: Transaction, id: string, status: '冷藏' | '已放弃'): Promise<void> {
  const task = findTask(tx, id), current = openSegmentInTx(tx);
  tx.saveTask(leaveBackpack(task, status));
  for (const card of tx.cards.filter(item => item.task_id === id)) {
    if (status === '已放弃' && card.status !== '已完成' && card.status !== '已放弃') tx.saveCard({ ...card, status: '已放弃' });
    else if (status === '冷藏' && card.status === '进行中') tx.saveCard(releaseCard(card));
    if (tx.state.current_card === card.id) tx.state.current_card = null;
  }
  // A3: an inserted activity continues; resume checks the released/abandoned card later.
  if (current?.card_id && tx.cards.some(card => card.id === current.card_id && card.task_id === id)) await switchInTx(tx, tx.at, idleTarget(tx));
}

async function makeRoomInTx(tx: Transaction, slot: Task['slot'], room: MakeRoom | null | undefined): Promise<void> {
  if (!room) return;
  const task = findTask(tx, room.id);
  if (slot === '不在背包' || !inBackpack(task) || task.slot !== slot) throw new Error('腾位项目必须在目标类型的背包格内');
  await removeTaskInTx(tx, room.id, room.action === '放弃' ? '已放弃' : '冷藏');
}

export async function createTaskInTx(tx: Transaction, draft: TaskDraft): Promise<string> {
  const at = tx.at;
  if (!draft.name.trim()) throw new Error('项目名不能为空');
  await makeRoomInTx(tx, draft.slot, draft.makeRoom);
  let task: Task = { id: tx.id(), name: draft.name.trim(), slot: '不在背包', slot_index: null, status: '进行中', created_at: at, bet_ends_at: null };
  if (draft.slot !== '不在背包') task = putInBackpack(task, draft.slot, tx.tasks, tx.settings, at);
  tx.saveTask(task); refreshInTx(tx);
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

export const saveCard = (ctx: Ctx, cardId: string | null, fields: CardFields, at: string) => run(ctx, async tx => {
  if (fields.taskId !== null) findTask(tx, fields.taskId);
  const original = cardId === null ? null : tx.cards.find(card => card.id === cardId);
  if (cardId !== null && !original) throw new Error('卡片不存在');
  if (original && original.status !== '待做' && original.status !== '进行中') throw new Error('只能编辑待做或进行中的卡');
  let card = original ? editCard(original, fields) : createCard(tx.id(), fields, at, Math.max(0, ...tx.cards.map(item => item.order)) + 1);
  const task = tx.tasks.find(item => item.id === card.task_id), current = openSegmentInTx(tx);
  const eligible = card.task_id === null || (!!task && inBackpack(task));
  if (!eligible) {
    card = releaseCard(card);
    if (tx.state.current_card === card.id) tx.state.current_card = null;
  }
  tx.saveCard(card);
  if (current?.card_id === card.id) {
    const project = trackOf(card.task_id, tx.tasks);
    if (!eligible) await switchInTx(tx, at, idleTarget(tx));
    else if (current.activity !== card.content || current.project !== project) await switchInTx(tx, at,
      { activity: card.content, project, card_id: card.id, kind: '普通', resume_card_id: null });
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
