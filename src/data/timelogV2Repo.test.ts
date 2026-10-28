import { expect, it } from 'vitest';
import { MemoryFs } from './memoryFs';
import { TimelogV2Repo } from './timelogV2Repo';
import { Journal, createWrite } from './journal';
import type { TimeEntry } from '../domain/timeline/entry';

const time = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString();
const entry = (): TimeEntry => ({ id: 'cross-day', started_at: time(27, 3), ended_at: time(28, 5),
  description: 'work', project: '学习', tags: [], card_id: null, kind: '普通', source: '手动', updated_at: time(28, 5) });
it('stores once by start activity-day, queries intersecting later days, and moves/deletes via the journal', async () => {
  const fs = new MemoryFs(), repo = new TimelogV2Repo(fs), journal = new Journal(fs), now = time(28, 6);
  const save = async (rows: TimeEntry[]) => { const writes = await repo.writes(rows, now, 4); await journal.run(crypto.randomUUID(), writes); repo.acceptCommitted(writes); };
  await save([entry()]);
  expect(await fs.list('timelog')).toEqual(['timelog/2026-10-26.md']);
  expect(repo.between(time(28, 0), time(28, 6))).toHaveLength(1);
  const reloaded = new TimelogV2Repo(fs); expect(await reloaded.scan(now, 4)).toEqual([entry()]);
  await save([{ ...entry(), started_at: time(27, 5) }]);
  expect(await fs.list('timelog')).toEqual(['timelog/2026-10-27.md']);
  await save([]); expect(await fs.list('timelog')).toEqual([]);
});
it('does not publish a partial write, and recovery reconstructs the full timeline', async () => {
  const fs = new MemoryFs(), repo = new TimelogV2Repo(fs), journal = new Journal(fs), now = time(28, 6);
  const writes = [...await repo.writes([entry()], now, 4), createWrite('state.yaml', 'schemaVersion: 2', null)];
  fs.beforeWrite = path => { if (path === 'state.yaml') throw new Error('power loss'); };
  await expect(journal.run(crypto.randomUUID(), writes)).rejects.toThrow('power loss');
  expect(repo.snapshot()).toEqual([]);
  fs.beforeWrite = undefined; await journal.recover();
  expect(await new TimelogV2Repo(fs).scan(now, 4)).toEqual([entry()]);
});
