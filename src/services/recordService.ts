import type { RecordEntry, RecordInput } from '../domain/record/record';
import { createRecord } from '../domain/record/record';
import { convert } from '../domain/record/convert';
import type { Card } from '../domain/card/card';
import { editCardContent } from '../domain/card/edit';
import type { Task } from '../domain/task/task';
import { inBackpack } from '../domain/task/task';
import { itemCapacity, replaceableSingle, singleItemTask } from '../domain/task/pool';
import type { Ctx, Transaction } from './commit';
import { run } from './commit';
import { refreshInTx } from './dealService';
import { refElapsedInTx } from './tracking/api';

export async function saveRecord(ctx: Ctx, record: RecordInput): Promise<void> {
  await run(ctx, async tx => { saveRecordInTx(tx, record); }, record.created_at);
}

export function saveRecordInTx(tx: Transaction, record: RecordInput): RecordEntry {
  if (tx.records.some(item => item.id === record.id)) throw new Error('记录已经存在');
  const created = createRecord(record);
  tx.saveRecord(created);
  return created;
}

export interface CaptureTodoInput {
  text: string;
  task_id?: string | null;
  due_at?: string | null;
  blocking?: boolean;
}

function findLinkedCard(tx: Transaction, record: RecordEntry, fallbackId: string): Card | undefined {
  return (record.card_id ? tx.cards.find(item => item.id === record.card_id) : undefined)
    ?? tx.cards.find(item => item.id === fallbackId || item.source_record_id === record.id);
}

function materializeTodoRecordInTx(
  tx: Transaction,
  record: RecordEntry,
  nextOrder: () => number,
): { record: RecordEntry; card: Card; task: Task | undefined; created: boolean } {
  const defaultCardId = `card-${record.id}`;
  const existing = findLinkedCard(tx, record, defaultCardId);
  if (existing) {
    const linkedRecord = record.card_id === existing.id ? record : { ...record, card_id: existing.id };
    if (linkedRecord !== record) tx.saveRecord(linkedRecord);
    const existingTask = existing.task_id ? tx.tasks.find(item => item.id === existing.task_id) : undefined;
    return { record: linkedRecord, card: existing, task: existingTask, created: false };
  }

  let task = record.task_id ? tx.tasks.find(item => item.id === record.task_id) : undefined;
  const placeholder = task ? replaceableSingle(task, tx.cards, id => refElapsedInTx(tx, id)) : null;
  let card: Card;
  if (placeholder && task) {
    card = {
      ...editCardContent(placeholder, record.text),
      source_record_id: record.id,
      tags: [...record.tags],
      due_at: record.due_at,
      blocking: record.blocking,
    };
    tx.saveCard(card);
  } else {
    const converted = convert(record, nextOrder());
    if (!task) {
      // E4: the capture inbox may exceed side-task capacity, but never drops a saved record.
      task = singleItemTask(converted);
      if (!tx.tasks.some(value => value.id === task!.id)) tx.saveTask(task);
    }
    card = { ...converted, task_id: task.id };
    tx.saveCard(card);
  }
  const linkedRecord = (record.card_id === card.id && record.task_id === task.id)
    ? record
    : { ...record, task_id: task.id, card_id: card.id };
  if (linkedRecord !== record) tx.saveRecord(linkedRecord);
  return { record: linkedRecord, card, task, created: true };
}

export function captureTodoInTx(tx: Transaction, input: CaptureTodoInput): { record: RecordEntry; card: Card; task: Task } {
  const targetTaskId = input.task_id ?? null;
  if (targetTaskId !== null) {
    const task = tx.tasks.find(item => item.id === targetTaskId);
    if (!task || !inBackpack(task)) {
      throw new Error('TASK_NOT_IN_BACKPACK：目标任务不存在或不在当前背包中');
    }
    const placeholder = replaceableSingle(task, tx.cards, id => refElapsedInTx(tx, id));
    if (!placeholder && itemCapacity(task, tx.cards, tx.settings) <= 0) {
      throw new Error('MAIN_TASK_FULL：主线任务事项已满，无法继续添加待办');
    }
  }
  const record = saveRecordInTx(tx, {
    id: tx.id(),
    text: input.text,
    kind: '待办',
    created_at: tx.at,
    due_at: input.due_at ?? null,
    blocking: input.blocking ?? false,
    task_id: targetTaskId,
    card_id: null,
    tags: [],
    attachments: [],
  });
  let order = Math.max(0, ...tx.cards.map(item => item.order));
  const result = materializeTodoRecordInTx(tx, record, () => ++order);
  if (!result.task) throw new Error('TASK_NOT_FOUND：捕捉待办未能建立任务关联');
  refreshInTx(tx);
  return { record: result.record, card: result.card, task: result.task };
}

export async function reconcile(ctx: Ctx): Promise<number> {
  return run(ctx, async tx => {
    let order = Math.max(0, ...tx.cards.map(card => card.order)), created = 0;
    for (const record of tx.records) {
      if (record.kind !== '待办') continue;
      const result = materializeTodoRecordInTx(tx, record, () => ++order);
      if (result.created) created++;
    }
    refreshInTx(tx);
    await tx.log(`reconcile:${created}`);
    return created;
  });
}
