// 0.3.0-beta.3 E0.5：entityChanges.changed() 给出改前改后（ADR 0019 第 4 条）。
import { expect, it } from 'vitest';
import { MemoryFs } from '../data/memoryFs';
import { createRepos } from '../data/repos';
import { card } from './serviceFixture';
import { entityChanges } from './entityChanges';

async function seeded() {
  const repos = createRepos(new MemoryFs());
  await repos.transact(crypto.randomUUID(), [await repos.cards.write(card('a'), null), await repos.cards.write(card('b'), null)]);
  return { repos, changes: entityChanges(repos.cards, await repos.cards.list()) };
}

it('decodes before from the loaded text even when a service mutated the loaded object in place', async () => {
  const { repos, changes } = await seeded();
  const original = (await repos.cards.get('a'))!.value;
  const loaded = changes.values.find(value => value.id === 'a')!;
  loaded.content = '就地改过';
  changes.save(loaded);
  expect(changes.changed()).toEqual([{ id: 'a', before: original, after: loaded }]);
  expect(original.content).not.toBe('就地改过');
});

it('lists created, removed and saved-unchanged entities, and drops one created then removed in the same transaction', async () => {
  const { changes } = await seeded();
  const b = changes.values.find(value => value.id === 'b')!;
  changes.save(card('c'));
  changes.remove('a');
  changes.save(b);
  changes.save(card('d')); changes.remove('d');
  const list = changes.changed();
  expect(list.map(item => item.id)).toEqual(['c', 'a', 'b']);
  expect(list[0]).toMatchObject({ before: null, after: { id: 'c' } });
  expect(list[1]).toMatchObject({ before: { id: 'a' }, after: null });
  expect(list[2].before).toEqual(list[2].after);
});

it('after is a copy, so later mutation in the transaction does not rewrite what was captured', async () => {
  const { changes } = await seeded();
  const value = card('e'); changes.save(value);
  const [captured] = changes.changed();
  value.content = 'later';
  expect(captured.after!.content).not.toBe('later');
});
