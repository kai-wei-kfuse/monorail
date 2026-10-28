import { expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { defaults } from '../shared/settings';
import { MemoryFs } from './memoryFs';
import { SettingsRepo } from './settingsRepo';
import { Journal } from './journal';

it('uses isolated defaults only when settings.yaml does not exist', async () => {
  const repo = new SettingsRepo(new MemoryFs());
  const first = await repo.read(); first.lists.quickActivities.push({ id: 'x', name: '走走', project: '生活' });
  expect(await repo.read()).toEqual(defaults);
});
it('loads settings and user lists from disk and preserves unknown fields on edit', async () => {
  const fs = new MemoryFs(), repo = new SettingsRepo(fs);
  await fs.atomicWrite('settings.yaml', stringify({ ...defaults, dayBoundaryHour: 6, extra: { theme: 'paper' }, lists: { ...defaults.lists, external: true, quickActivities: [{ id: 'wc', name: '厕所', project: '生活' }], restPool: [{ id: 'look', name: '看窗外' }], idleName: '等待' } }));
  const loaded = await repo.read();
  expect(loaded.dayBoundaryHour).toBe(6); expect(loaded.lists.idleName).toBe('等待');
  await new Journal(fs).run(crypto.randomUUID(), [await repo.write({ ...loaded, deadlineLeadMinutes: 15 })]);
  expect(await repo.read()).toMatchObject({ deadlineLeadMinutes: 15, lists: { restPool: [{ id: 'look', name: '看窗外' }] } });
  expect(parse((await fs.read('settings.yaml'))!.text)).toMatchObject({ extra: { theme: 'paper' }, lists: { external: true } });
});
it.each(['broken: [', 'dayBoundaryHour: invalid', stringify({ ...defaults, lists: { ...defaults.lists, quickActivities: [{ id: 'x', name: 'a', project: '生活' }, { id: 'x', name: 'b', project: '生活' }] } })])('rejects invalid existing settings instead of silently applying defaults', async source => {
  const fs = new MemoryFs(); await fs.atomicWrite('settings.yaml', source);
  await expect(new SettingsRepo(fs).read()).rejects.toThrow('settings.yaml');
});
it('preserves long lists within the explicitly configured numeric bounds', async () => {
  const fs = new MemoryFs(), repo = new SettingsRepo(fs);
  const value = { ...structuredClone(defaults), longActivityMinutes: 720, lists: { ...defaults.lists, restPool: Array.from({ length: 100 }, (_, n) => ({ id: String(n), name: `休息${n}` })) } };
  await new Journal(fs).run(crypto.randomUUID(), [await repo.write(value)]);
  expect(await repo.read()).toEqual(value);
});
