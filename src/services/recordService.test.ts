import { expect, it, vi } from 'vitest';
import { at, card, fixture, getCard, task, seed } from './serviceFixture';
import { saveRecord, reconcile } from './recordService';
import { run } from './commit';
import type { RecordInput } from '../domain/record/record';

function record(): RecordInput {
  return { id: crypto.randomUUID(), text: '原始待办', kind: '待办', created_at: at(), due_at: at(90),
    blocking: true, task_id: null, card_id: null, tags: ['tag'], attachments: [] };
}
it('A4 reconciles a blocker, its record link, selection and deadline plan in one idempotent transaction', async () => {
  const f = fixture(); await seed(f, [card('a')]);
  const entry = record(), id = `card-${entry.id}`; await saveRecord(f.ctx, entry);
  const transact = vi.spyOn(f.ctx.repos, 'transact');
  expect(await reconcile(f.ctx)).toBe(1); expect(transact).toHaveBeenCalledTimes(1);
  expect((await f.ctx.repos.records.get(entry.id))!.value.card_id).toBe(id);
  expect(await f.ctx.repos.state.read()).toMatchObject({ current_card: 'a', seen: [], refusals: [] });
  expect(f.publish.mock.calls.at(-1)![0]).toMatchObject({ cards: expect.arrayContaining([expect.objectContaining({ id })]), home: { card: { id: 'a' } } });
  expect(f.update.mock.calls.at(-1)![0]).toContainEqual(expect.objectContaining({ at: Date.parse(at(30)), body: entry.text }));
  expect(await reconcile(f.ctx)).toBe(0);
  expect(await f.ctx.repos.cards.list()).toHaveLength(2);
});
it('A4 later record edits never overwrite execution fields owned by the card', async () => {
  const f = fixture(); await seed(f, [], [task('main')]);
  const entry = record(), id = `card-${entry.id}`; await saveRecord(f.ctx, entry); await reconcile(f.ctx);
  await run(f.ctx, async tx => { tx.saveCard({ ...tx.cards[0], blocking: false, due_at: null, task_id: 'main', type: '时间盒卡', timebox_minutes: 25 }); });
  const entity = (await f.ctx.repos.records.get(entry.id))!;
  await f.ctx.repos.transact(crypto.randomUUID(), [await f.ctx.repos.records.write({ ...entity.value, text: '改原文', due_at: at(120), blocking: true, task_id: null }, entity)]);
  expect(await reconcile(f.ctx)).toBe(0);
  expect(await getCard(f, id)).toMatchObject({ content: entry.text, blocking: false, due_at: null, task_id: 'main', type: '时间盒卡', timebox_minutes: 25 });
  expect(f.update.mock.calls.at(-1)![0].filter(p => p.id.startsWith('deadline:'))).toEqual([]);
});
it('repairs a missing record backlink without duplicating or overwriting the existing card; ignores ideas', async () => {
  const f = fixture(), entry = record(), id = `card-${entry.id}`;
  await seed(f, [card(id, { content: '执行中的编辑' })]); await saveRecord(f.ctx, entry);
  await saveRecord(f.ctx, { ...record(), kind: '想法' });
  expect(await reconcile(f.ctx)).toBe(0);
  expect(await f.ctx.repos.cards.list()).toHaveLength(1);
  expect((await f.ctx.repos.records.get(entry.id))!.value.card_id).toBe(id);
  expect((await getCard(f, id)).content).toBe('执行中的编辑');
});
