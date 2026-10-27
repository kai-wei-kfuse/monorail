import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { expect, it } from 'vitest';
import { createRepos } from '../data/repos';
import { MemoryFs } from '../data/memoryFs';
import { createContext } from '../services/commit';
import type { Snapshot } from '../services/commit';
import { reconcile } from '../services/recordService';
import { restoreRepositories } from './bootstrap';
import { cardView } from '../pages/home/HomePage';

it('replays the real restart snapshot with B away: first publish counts B only, never A or the insert', async () => {
  const root = resolve('evidence/m1-wire/readout-bug-data'), fs = new MemoryFs();
  for (const folder of ['', 'cards', 'records', 'timelog']) {
    for (const entry of await readdir(resolve(root, folder), { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = resolve(root, folder, entry.name);
      await fs.atomicWrite(relative(root, path).replaceAll('\\', '/'), await readFile(path, 'utf8'));
    }
  }
  const repos = createRepos(fs), captured = (await repos.times.scan()).flatMap(day => day.segments);
  const inserted = captured.find(segment => segment.seq === 8)!;
  const b = (await repos.cards.get(inserted.resume_card_id!))!;
  const at = '2026-10-27T02:31:17.000Z';
  // The supplied files were captured after completion; rewind only later events to the screenshot.
  const replay = captured.filter(segment => segment.seq <= 8).map(segment => segment.seq === 8 ? { ...segment, ended_at: null } : segment);
  const restartFs = new MemoryFs(), restarted = createRepos(restartFs);
  const state = await repos.state.read();
  await restarted.transact(crypto.randomUUID(), [
    ...await restarted.times.writes(replay.map(segment => ({ day: '2026-10-27', segment }))),
    ...await Promise.all((await repos.records.list()).map(entity => restarted.records.write(entity.value, null))),
    ...await Promise.all((await repos.cards.list()).map(entity => restarted.cards.write(entity.value.id === b.value.id
      ? { ...entity.value, status: '进行中', completed_at: null, completed_day: null, completed_track: null } : entity.value, null))),
    await restarted.state.write({ ...state, max_seq: 8, current_card: b.value.id, open_segment: inserted.id, home_mode: 'task' }),
  ]);
  // A new repo instance rebuilds its cache from disk, as bootstrap does on a real process restart.
  const fresh = createRepos(restartFs);
  await restoreRepositories(fresh, () => crypto.randomUUID(), () => at);
  const published: Snapshot[] = [];
  const ctx = createContext({ repos: fresh, settings: await repos.settings.read(), id: () => crypto.randomUUID(), now: () => at,
    log: async () => {}, reminders: { update: async () => {} }, publish: value => { published.push(value); } });
  await reconcile(ctx);
  expect(published).toHaveLength(1);
  const home = published[0].home;
  expect(home).toMatchObject({ mode: 'task', card: { id: b.value.id, status: '进行中' }, awayActivity: '厕所',
    closedEffectiveMs: 27715, currentSegStartedAt: null, activity: { kind: 'away', startedAt: inserted.started_at } });
  expect(Date.parse(at) - Date.parse(inserted.started_at)).toBe(40255);
  expect(cardView(home, Date.parse(at))?.elapsedMs).toBe(27715);
  expect(cardView(home, Date.parse(at) + 60000)?.elapsedMs).toBe(27715);
});
