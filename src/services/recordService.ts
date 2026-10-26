import type { RecordEntry } from '../domain/record/record';
import { convert } from '../domain/record/convert';
import type { Ctx } from './commit';

export async function saveRecord(ctx: Ctx, record: RecordEntry): Promise<void> {
  await ctx.commit(async tx => {
    if (await ctx.records.get(record.id)) throw new Error('记录已经存在');
    tx.writes.push(await ctx.records.write(record, null, record.text));
  });
}

export async function reconcile(ctx: Ctx): Promise<number> {
  return ctx.commit(async tx => {
    const records = await ctx.records.list(), cards = await ctx.cards.list();
    let order = Math.max(0, ...cards.map(c => c.value.order)), created = 0;
    for (const record of records) {
      if (record.value.kind !== '待办') continue;
      const card = convert(record.value, ++order), existing = await ctx.cards.get(card.id);
      if (!existing) { tx.writes.push(await ctx.cards.write(card, null)); created++; }
      if (record.value.card_id !== card.id) tx.writes.push(await ctx.records.write({ ...record.value, card_id: card.id }, record));
      // The skeleton has only loose tasks; it preserves the ongoing card.
      if (!tx.state.current_card && (!existing || existing.value.status === '待做')) tx.state.current_card = card.id;
    }
    await ctx.log(`reconcile:${created}`);
    return created;
  });
}
