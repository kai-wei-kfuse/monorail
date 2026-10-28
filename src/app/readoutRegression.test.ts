import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { parse, stringify } from 'yaml';
import { expect, it } from 'vitest';
import { createRepos } from '../data/repos';
import { MemoryFs } from '../data/memoryFs';
import { decode, encode } from '../data/frontmatter';
import type { Segment } from '../data/migrations/v1/segment';
import { createContext } from '../services/commit';
import type { Snapshot } from '../services/commit';
import { reconcile } from '../services/recordService';
import { restoreRepositories } from './bootstrap';
import { cardView } from '../pages/home/HomePage';

it('migrates the real restart snapshot with B away without counting A or the interruption', async () => {
  const root = resolve('evidence/m1-wire/readout-bug-data'), fs = new MemoryFs();
  for (const folder of ['', 'cards', 'records', 'timelog']) {
    for (const entry of await readdir(resolve(root, folder), { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = resolve(root, folder, entry.name);
      await fs.atomicWrite(relative(root, path).replaceAll('\\', '/'), await readFile(path, 'utf8'));
    }
  }
  const captured = parse((await fs.read('timelog/2026-10-27.md'))!.text) as Segment[];
  const inserted = captured.find(entry => entry.seq === 8)!, bId = inserted.resume_card_id!;
  await fs.atomicWrite('timelog/2026-10-27.md', stringify(captured.filter(entry => entry.seq <= 8).map(entry => entry.seq === 8 ? { ...entry, ended_at: null } : entry)));
  const doc = decode((await fs.read(`cards/${bId}.md`))!.text, bId);
  await fs.atomicWrite(`cards/${bId}.md`, encode({ ...doc.meta, status: '进行中', completed_at: null, completed_day: null, completed_track: null }, doc.body));
  const state = parse((await fs.read('state.yaml'))!.text);
  await fs.atomicWrite('state.yaml', stringify({ ...state, max_seq: 8, current_card: bId, open_segment: inserted.id, home_mode: 'task' }));
  const at = '2026-10-27T02:31:17.000Z', repos = createRepos(fs);
  const restored = await restoreRepositories(repos, () => crypto.randomUUID(), () => at), published: Snapshot[] = [];
  const ctx = createContext({ repos, settings: restored.settings, id: () => crypto.randomUUID(), now: () => at,
    log: async () => {}, reminders: { update: async () => {} }, publish: value => { published.push(value); } });
  await reconcile(ctx);
  expect(published).toHaveLength(1);
  const home = published[0].home;
  expect(home).toMatchObject({ mode: 'task', card: { id: bId, status: '进行中' }, awayActivity: '厕所',
    closedEffectiveMs: 27715, currentSegStartedAt: null, activity: { kind: 'away', startedAt: inserted.started_at } });
  expect(cardView(home, Date.parse(at))?.elapsedMs).toBe(27715);
  expect(cardView(home, Date.parse(at) + 60000)?.elapsedMs).toBe(27715);
});
