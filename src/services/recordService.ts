import type { RecordInput } from '../domain/record/record';
import { createRecord } from '../domain/record/record';
import { convert } from '../domain/record/convert';
import type { Ctx } from './commit';
import { run } from './commit';
import { refreshInTx } from './dealService';

export async function saveRecord(ctx: Ctx, record: RecordInput): Promise<void> {
  await run(ctx, async tx => {
    if (tx.records.some(item => item.id === record.id)) throw new Error('记录已经存在');
    tx.saveRecord(createRecord(record));
  });
}

export async function reconcile(ctx: Ctx): Promise<number> {
  return run(ctx, async tx => {
    let order = Math.max(0, ...tx.cards.map(card => card.order)), created = 0;
    for (const record of tx.records) {
      if (record.kind !== '待办') continue;
      const card = convert(record, ++order), existing = tx.cards.find(item => item.id === card.id);
      if (!existing) { tx.saveCard(card); created++; }
      if (record.card_id !== card.id) tx.saveRecord({ ...record, card_id: card.id });
    }
    refreshInTx(tx);
    await tx.log(`reconcile:${created}`);
    return created;
  });
}
