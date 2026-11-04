// 待办记录 → 卡片 / 任务（原在 recordService，0.3.0-beta.3 E8a3 挪出来）：commit.ts 的快速记录条吸收也要用，
// 放在这里避免 commit.ts ↔ recordService 的循环引用。
import type { RecordEntry } from '../domain/record/record';
import { convert } from '../domain/record/convert';
import type { Card } from '../domain/card/card';
import { editCardContent } from '../domain/card/edit';
import type { Task } from '../domain/task/task';
import { replaceableSingle, singleItemTask } from '../domain/task/pool';
import type { Transaction } from './commit';
import { refElapsedInTx } from './tracking/api';

function findLinkedCard(tx: Transaction, record: RecordEntry, fallbackId: string): Card | undefined {
  return (record.card_id ? tx.cards.find(item => item.id === record.card_id) : undefined)
    ?? tx.cards.find(item => item.id === fallbackId || item.source_record_id === record.id);
}

export function materializeTodoRecordInTx(
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
