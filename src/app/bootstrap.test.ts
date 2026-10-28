import { expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { MemoryFs } from '../data/memoryFs';
import { createRepos } from '../data/repos';
import { initialState as v1State } from '../data/migrations/v1/stateRepo';
import { defaults as v1Defaults } from '../data/migrations/v1/settings';
import { restoreRepositories } from './bootstrap';
import { createContext, run } from '../services/commit';

const now = () => new Date(2026, 9, 27, 10).toISOString(), id = () => crypto.randomUUID();
const oldEntry = () => ({ id: id(), seq: 1, started_at: new Date(2026, 9, 26, 10).toISOString(), ended_at: null,
  activity: '学习', category: '支线', card_id: null, kind: '普通', source: '手动', resume_card_id: null });
it('migrates before v2 parsing, scans once, and preserves stored settings', async () => {
  const fs = new MemoryFs(), entry = oldEntry(), repos = createRepos(fs);
  await fs.atomicWrite('timelog/2026-10-26.md', stringify([entry]));
  await fs.atomicWrite('state.yaml', stringify({ max_seq: 1, current_card: null, open_segment: entry.id, seen: [], stopped_day: null }));
  await fs.atomicWrite('settings.yaml', stringify({ ...v1Defaults, deadlineLeadMinutes: 17 }));
  const scan = vi.spyOn(repos.times, 'scan');
  const restored = await restoreRepositories(repos, id, now);
  expect(restored.migration.migrated).toBe(true); expect(scan).toHaveBeenCalledTimes(1);
  expect(await repos.state.read()).toMatchObject({ schemaVersion: 2, open_entry_day: '2026-10-26' });
  expect(restored.settings.deadlineLeadMinutes).toBe(17);
  const ctx = createContext({ repos, settings: restored.settings, id, now, publish: () => {}, log: async () => {}, reminders: { update: async () => {} } });
  await run(ctx, async tx => { expect(tx.settings.deadlineLeadMinutes).toBe(17); });
  expect(scan).toHaveBeenCalledTimes(1);
});
it('rejects corrupt v1 max_seq before migration', async () => {
  const fs = new MemoryFs(), entry = oldEntry();
  await fs.atomicWrite('timelog/2026-10-26.md', stringify([entry]));
  await fs.atomicWrite('state.yaml', stringify({ ...v1State, open_segment: entry.id }));
  await expect(restoreRepositories(createRepos(fs), id, now)).rejects.toThrow('max_seq');
});
it('rejects wrong v2 persisted open-day pointers', async () => {
  const fs = new MemoryFs(), repos = createRepos(fs);
  await restoreRepositories(repos, id, now);
  const state = await repos.state.read();
  await repos.transact(id(), [await repos.state.write({ ...state, open_entry_day: '2026-10-25' })]);
  await expect(restoreRepositories(createRepos(fs), id, now)).rejects.toThrow('日期不一致');
});
it('does not hide invalid historical files during migration', async () => {
  const fs = new MemoryFs(); await fs.atomicWrite('timelog/2026-10-01.md', 'bad history');
  await expect(restoreRepositories(createRepos(fs), id, now)).rejects.toThrow('timelog/2026-10-01.md');
});
