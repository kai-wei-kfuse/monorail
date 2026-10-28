import { expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { MemoryFs } from '../data/memoryFs';
import { createRepos } from '../data/repos';
import { initialState } from '../data/stateRepo';
import { defaults } from '../shared/settings';
import type { Segment } from '../domain/timeline/segment';
import { restoreRepositories } from './bootstrap';
import { createContext, run } from '../services/commit';

const now = () => new Date(2026, 9, 27, 10).toISOString();
const id = () => crypto.randomUUID();
const openSegment = (): Segment => ({ id: id(), seq: 1, started_at: new Date(2026, 9, 26, 10).toISOString(), ended_at: null, activity: '学习', project: '支线', card_id: null, kind: '普通', source: '手动', resume_card_id: null });

it('scans once at startup, migrates old open-day state and injects stored settings', async () => {
  const fs = new MemoryFs(), repos = createRepos(fs), segment = openSegment();
  await repos.transact(id(), [...await repos.times.writes([{ day: '2026-10-26', segment }])]);
  await fs.atomicWrite('state.yaml', stringify({ max_seq: 1, current_card: null, open_segment: segment.id, seen: [], stopped_day: null }));
  await fs.atomicWrite('settings.yaml', stringify({ ...defaults, deadlineLeadMinutes: 17, lists: { ...defaults.lists, idleName: '等候' } }));
  const scan = vi.spyOn(repos.times, 'scan');
  const restored = await restoreRepositories(repos, id, now);
  expect(scan).toHaveBeenCalledTimes(1);
  expect((await repos.state.read()).open_segment_day).toBe('2026-10-26');
  expect(restored.settings).toMatchObject({ deadlineLeadMinutes: 17, lists: { idleName: '等候' } });
  const ctx = createContext({ repos, settings: restored.settings, id, now, publish: () => {}, log: async () => {}, reminders: { update: async () => {} } });
  await run(ctx, async tx => { expect(tx.settings.lists.idleName).toBe('等候'); });
  expect(scan).toHaveBeenCalledTimes(1);
});

it('rejects stale max_seq at startup instead of allocating duplicate sequence values', async () => {
  const repos = createRepos(new MemoryFs());
  await repos.transact(id(), [...await repos.times.writes([{ day: '2026-10-26', segment: openSegment() }])]);
  await expect(restoreRepositories(repos, id, now)).rejects.toThrow('max_seq');
});

it('rejects wrong persisted open-day pointers rather than silently repairing corruption', async () => {
  const repos = createRepos(new MemoryFs()), segment = openSegment();
  await repos.transact(id(), [...await repos.times.writes([{ day: '2026-10-26', segment }]), await repos.state.write({ ...initialState, max_seq: 1, open_segment: segment.id, open_segment_day: '2026-10-25' })]);
  await expect(restoreRepositories(repos, id, now)).rejects.toThrow('日期不一致');
});

it('does not hide invalid historical files during startup audit', async () => {
  const fs = new MemoryFs(); await fs.atomicWrite('timelog/2026-10-01.md', 'bad history');
  await expect(restoreRepositories(createRepos(fs), id, now)).rejects.toThrow('timelog/2026-10-01.md');
});
