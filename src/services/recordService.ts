import type { RecordEntry } from '../domain/record/record';
import { convert } from '../domain/record/convert';
import type { Ctx } from './commit';
import { run } from './commit';
import { refreshInTx } from './dealService';

export async function saveRecord(ctx: Ctx, record: RecordEntry): Promise<void> {
  await run(ctx, async tx => {
    if (await tx.repos.records.get(record.id)) throw new Error('记录已经存在');
    tx.writes.push(await tx.repos.records.write(record, null, record.text));
  });
}

export async function reconcile(ctx: Ctx): Promise<number> {
  return run(ctx, async tx => {
    const records = await tx.repos.records.list();
    let order = Math.max(0, ...tx.cards.map(card => card.order)), created = 0;
    for (const record of records) {
      if (record.value.kind !== '待办') continue;
      const card = convert(record.value, ++order), existing = tx.cards.find(item => item.id === card.id);
      if (!existing) { tx.saveCard(card); created++; }
      if (record.value.card_id !== card.id) tx.writes.push(await tx.repos.records.write({ ...record.value, card_id: card.id }, record));
    }
    refreshInTx(tx);
    await tx.log(`reconcile:${created}`);
    return created;
  });
}
