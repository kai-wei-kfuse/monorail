import { expect, it, vi } from 'vitest';
import { createRepos } from './repos';
import { MemoryFs } from './memoryFs';
import type { TimeEntry } from '../domain/timeline/entry';

const day = '2026-10-26';
const entry = (): TimeEntry => ({ id: crypto.randomUUID(), started_at: `${day}T10:00:00Z`, ended_at: null,
  description: 'task', project: '支线', card_id: 'one', kind: '普通', source: '手动', tags: [], updated_at: `${day}T10:00:00Z` });

it('publishes committed history in memory and reconstructs it on startup without snapshot IO', async () => {
  const fs = new MemoryFs(), repos = createRepos(fs), open = entry();
  const writes = await repos.times.writes([open], `${day}T12:00:00Z`, 4);
  expect(repos.times.snapshot()).toEqual([]);
  await repos.transact(crypto.randomUUID(), writes);
  expect(repos.times.snapshot()).toEqual([open]);
  const closed = { ...open, ended_at: `${day}T11:00:00Z` };
  await repos.transact(crypto.randomUUID(), await repos.times.writes([closed], `${day}T12:00:00Z`, 4));
  const restarted = createRepos(fs);
  await restarted.recover(); await restarted.times.scan(`${day}T12:00:00Z`, 4);
  const read = vi.spyOn(fs, 'read'), list = vi.spyOn(fs, 'list');
  expect(restarted.times.snapshot()).toEqual([closed]);
  expect(read).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
});

it('never publishes a partial transaction; recovery plus startup scan rebuilds the index', async () => {
  const fs = new MemoryFs(), repos = createRepos(fs), open = entry();
  fs.beforeWrite = path => { if (path === 'state.yaml') throw new Error('fault'); };
  await expect(repos.transact(crypto.randomUUID(), [
    ...await repos.times.writes([open], `${day}T12:00:00Z`, 4), await repos.state.write(await repos.state.read()),
  ])).rejects.toThrow('fault');
  expect(repos.times.snapshot()).toEqual([]);
  fs.beforeWrite = undefined;
  const restarted = createRepos(fs);
  expect(await restarted.recover()).toBe(1);
  await restarted.times.scan(`${day}T12:00:00Z`, 4);
  expect(restarted.times.snapshot()).toEqual([open]);
});
