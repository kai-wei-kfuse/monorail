import type { RecordEntry, RecordInput } from '../domain/record/record';
import { createRecord } from '../domain/record/record';
import type { Card } from '../domain/card/card';
import type { Task } from '../domain/task/task';
import { inBackpack } from '../domain/task/task';
import { itemCapacity, replaceableSingle } from '../domain/task/pool';
import { materializeTodoRecordInTx } from './recordMaterialize';
import type { Ctx, Transaction } from './commit';
import { run } from './commit';
import { refreshInTx } from './dealService';
import { refElapsedInTx } from './tracking/api';

export async function saveRecord(ctx: Ctx, record: RecordInput): Promise<void> {
  await run(ctx, async tx => { saveRecordInTx(tx, record); }, record.created_at, { action: 'record.save' });
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
    blocking: false,   // 0.3.1 删除阻塞机制（已定 12）：照写 false 供 0.3.0 读
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
  }, undefined, { action: 'system.reconcile', source: { kind: 'system', trigger: 'reconcile' } });
}
