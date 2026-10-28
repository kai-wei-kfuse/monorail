import { expect, it, vi } from 'vitest';
import { at, fixture, task, seed } from './serviceFixture';
import type { Fixture } from './serviceFixture';
import { createRecord } from '../domain/record/record';
import type { RecordEntry } from '../domain/record/record';
import { activeIdeas, coldOffer } from '../domain/idea/pool';
import { pair } from '../domain/idea/arena';
import { convertIdea, deleteIdea, editIdea, expire, revive, resolveDuel } from './ideaService';
import { saveRecord, reconcile } from './recordService';
import { run } from './commit';

function idea(fields: Partial<RecordEntry> = {}): RecordEntry {
  return { ...createRecord({ id: crypto.randomUUID(), text: '学点东西 #想法', kind: '想法', created_at: at(), due_at: null,
    blocking: false, task_id: null, card_id: null, tags: [], attachments: [], needs: '服务器' }), ...fields };
}
const records = async (f: Fixture) => (await f.ctx.repos.records.list()).map(entity => entity.value);
async function ideas(f: Fixture, entries: RecordEntry[]) { await run(f.ctx, async tx => { entries.forEach(entry => tx.saveRecord(entry)); }); }

it('A4 converts once in one transaction, retains the original idea and excludes it from pool limits', async () => {
  const f = fixture(), source = idea({ attachments: ['attachments/note.txt'] }); await seed(f, [], [task('p')]); await ideas(f, [source]);
  const transact = vi.spyOn(f.ctx.repos, 'transact');
  const cardId = await convertIdea(f.ctx, source.id, { content: '写一个脚本', taskId: 'p' }, at(10));
  expect(transact).toHaveBeenCalledTimes(1);
  expect((await records(f))[0]).toMatchObject({ kind: '想法', pool: '已转任务', card_id: cardId, text: source.text, last_touched_at: at(10), attachments: source.attachments });
  expect((await f.ctx.repos.cards.get(cardId))!.value).toMatchObject({ content: '写一个脚本', task_id: 'p', source_record_id: source.id });
  expect(activeIdeas(await records(f))).toEqual([]);
  await expect(convertIdea(f.ctx, source.id, { content: '再来', taskId: null }, at(10))).rejects.toThrow('已经转为');
  expect(await reconcile(f.ctx)).toBe(0); expect(await f.ctx.repos.cards.list()).toHaveLength(1);
});
it('new ideas can overflow the pool and reconciliation never turns them into cards', async () => {
  const f = fixture(); f.ctx.settings.ideaPoolLimit = 3;
  for (let n = 0; n < 5; n++) await saveRecord(f.ctx, idea({ text: `想法${n} #标签` }));
  expect(await reconcile(f.ctx)).toBe(0); expect(activeIdeas(await records(f))).toHaveLength(5);
  expect(f.publish.mock.calls.at(-1)![0].backpack.ideas).toHaveLength(5);
});
it('archives at exactly 60 days since last touch, excluding cold and converted ideas', async () => {
  const f = fixture(), old = idea(), edited = idea({ last_touched_at: at(1) }), converted = idea({ pool: '已转任务', card_id: 'card-old' });
  const cold = idea({ pool: '冷库', cold_since: at() }); await ideas(f, [old, edited, converted, cold]);
  const boundary = new Date(Date.parse(at()) + 60 * 86400000).toISOString(); f.clock(boundary);
  expect(await expire(f.ctx, boundary)).toBe(1);
  expect((await f.ctx.repos.records.get(old.id))!.value).toMatchObject({ pool: '冷库', cold_since: boundary, last_touched_at: at() });
  expect((await f.ctx.repos.records.get(edited.id))!.value.pool).toBe('活跃池');
  expect(await expire(f.ctx, boundary)).toBe(0);
});
it('editing updates touch and tags, while publishing or reading does not', async () => {
  const f = fixture(), a = idea(); await ideas(f, [a]); f.clock(at(10));
  await reconcile(f.ctx); expect((await records(f))[0].last_touched_at).toBe(at());
  await editIdea(f.ctx, a.id, { text: '编辑 #新标签', needs: ' 空闲机器 ' }, at(10));
  expect((await records(f))[0]).toMatchObject({ last_touched_at: at(10), tags: ['新标签'], needs: '空闲机器' });
});
it('revives two cold entries directly when free, resets expiry, and offers the oldest two only', async () => {
  const f = fixture(), a = idea({ pool: '冷库', cold_since: at() }), b = idea({ pool: '冷库', cold_since: at(1) }), c = idea({ pool: '冷库', cold_since: at(2) });
  await ideas(f, [c, b, a]); expect(coldOffer(await records(f)).map(i => i.id)).toEqual([a.id, b.id]);
  expect(await revive(f.ctx, [a.id, b.id], at(10))).toEqual({ kind: 'restored' });
  expect(activeIdeas(await records(f)).every(i => i.last_touched_at === at(10) && i.cold_since === null)).toBe(true);
});
it('full-pool revive requires confirmation and cancellation does not touch or activate the cold idea', async () => {
  const f = fixture(); f.ctx.settings.ideaPoolLimit = 2;
  const a = idea({ last_touched_at: at(-20) }), b = idea({ last_touched_at: at(-10) }), cold = idea({ pool: '冷库', cold_since: at() });
  await ideas(f, [a, b, cold]);
  await expect(revive(f.ctx, [cold.id], at(10))).rejects.toThrow('确认');
  expect(await revive(f.ctx, [cold.id], at(10), true)).toMatchObject({ kind: 'duel', left: { id: cold.id }, right: { id: a.id } });
  expect((await f.ctx.repos.records.get(cold.id))!.value).toEqual(cold);
  await resolveDuel(f.ctx, cold.id, a.id, at(10));
  expect(activeIdeas(await records(f))).toHaveLength(2);
  expect((await f.ctx.repos.records.get(cold.id))!.value).toMatchObject({ pool: '活跃池', last_touched_at: at(10) });
  expect((await f.ctx.repos.records.get(a.id))!.value).toMatchObject({ pool: '冷库', last_touched_at: at(10), cold_since: at(10) });
});
it('cold challenger may lose; a stale weakest opponent is rejected without changing either record', async () => {
  const f = fixture(); f.ctx.settings.ideaPoolLimit = 2;
  const a = idea({ last_touched_at: at(-20) }), b = idea({ last_touched_at: at(-10) }), cold = idea({ pool: '冷库', cold_since: at() });
  await ideas(f, [a, b, cold]); await revive(f.ctx, [cold.id], at(10), true);
  await editIdea(f.ctx, a.id, { text: a.text, needs: null }, at(10));
  await expect(resolveDuel(f.ctx, cold.id, a.id, at(11))).rejects.toThrow('对手已改变');
  await resolveDuel(f.ctx, b.id, cold.id, at(11));
  expect((await f.ctx.repos.records.get(cold.id))!.value).toMatchObject({ pool: '冷库', last_touched_at: at(11) });
});
it('arena pairs newest against least recently touched and eliminates until the configured limit', async () => {
  const f = fixture(); f.ctx.settings.ideaPoolLimit = 3;
  await ideas(f, Array.from({ length: 7 }, (_, n) => idea({ created_at: at(n), last_touched_at: at(n) })));
  let count = 0, duel = pair(await records(f), 3);
  expect(duel?.left.created_at).toBe(at(6)); expect(duel?.right.created_at).toBe(at());
  while (duel) { await resolveDuel(f.ctx, duel.left.id, duel.right.id, at(20 + count)); count++; duel = pair(await records(f), 3); }
  expect(count).toBe(4); expect(activeIdeas(await records(f))).toHaveLength(3);
  expect((await records(f)).filter(i => i.pool === '冷库')).toHaveLength(4);
});
it('explicit deletion removes the idea while its already generated card remains', async () => {
  const f = fixture(), a = idea(); await ideas(f, [a]);
  const id = await convertIdea(f.ctx, a.id, { content: '做', taskId: null }, at());
  await deleteIdea(f.ctx, a.id, at()); expect(await f.ctx.repos.records.get(a.id)).toBeNull();
  expect(await f.ctx.repos.cards.get(id)).not.toBeNull();
  expect(f.publish.mock.calls.at(-1)![0].backpack.ideas).toEqual([]);
});
it('metadata-only lifecycle edits preserve extended Markdown bodies and repeated changes write each record once', async () => {
  const f = fixture(), a = idea();
  await f.ctx.repos.transact(crypto.randomUUID(), [await f.ctx.repos.records.write(a, null, '完整长正文\n附加资料')]);
  const write = vi.spyOn(f.ctx.repos.records, 'write');
  await run(f.ctx, async tx => {
    tx.saveRecord({ ...tx.records[0], needs: '更多资料' });
    tx.saveRecord({ ...tx.records[0], last_touched_at: at(1) });
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect((await f.ctx.repos.records.get(a.id))!.body).toBe('完整长正文\n附加资料');
  await editIdea(f.ctx, a.id, { text: '新的全文', needs: null }, at(2));
  expect((await f.ctx.repos.records.get(a.id))!.body).toBe('新的全文');
});
