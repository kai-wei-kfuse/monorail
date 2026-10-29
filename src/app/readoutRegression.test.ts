import { stringify } from 'yaml';
import { expect, it } from 'vitest';
import { createRepos } from '../data/repos';
import { MemoryFs } from '../data/memoryFs';
import { encode } from '../data/frontmatter';
import { defaults } from '../data/migrations/v1/settings';
import { initialState } from '../data/migrations/v1/stateRepo';
import type { Segment } from '../data/migrations/v1/segment';
import { createContext } from '../services/commit';
import type { Snapshot } from '../services/commit';
import { reconcile } from '../services/recordService';
import { restoreRepositories } from './bootstrap';
import { cardView } from '../pages/home/HomePage';

it('migrates a restart snapshot with B away without counting A or the interruption', async () => {
  const fs = new MemoryFs(), bId = 'card-b';
  const aId = '00000000-0000-4000-8000-000000000001';
  const bSegmentId = '00000000-0000-4000-8000-000000000002';
  const awayId = '00000000-0000-4000-8000-000000000003';
  const start = '2026-10-27T02:30:00.000Z', switchAt = '2026-10-27T02:30:20.000Z';
  const awayAt = '2026-10-27T02:30:47.715Z', at = '2026-10-27T02:31:17.000Z';
  const card = (id: string, status: '待做' | '进行中') => ({ id, source_record_id: null, content: id, created_at: start,
    due_at: null, blocking: false, project_id: null, status, type: '结果卡', order: 1, timebox_minutes: null,
    no_shrink: false, shrunk_from: null, shrink_level: 0, continued_from: null, skip_count: 0,
    completed_at: null, completed_day: null, completed_track: null, progress_note: '' });
  const segments: Segment[] = [
    { id: aId, seq: 1, started_at: start, ended_at: switchAt, activity: 'A', category: '工作', card_id: 'card-a', kind: '普通', source: '手动', resume_card_id: null },
    { id: bSegmentId, seq: 2, started_at: switchAt, ended_at: awayAt, activity: 'B', category: '工作', card_id: bId, kind: '普通', source: '手动', resume_card_id: null },
    { id: awayId, seq: 3, started_at: awayAt, ended_at: null, activity: '厕所', category: '生活', card_id: null, kind: '插入', source: '手动', resume_card_id: bId },
  ];
  await fs.atomicWrite('settings.yaml', stringify(defaults));
  await fs.atomicWrite('state.yaml', stringify({ ...initialState, max_seq: 3, current_card: bId,
    open_segment: awayId, open_segment_day: '2026-10-27', home_mode: 'task' }));
  await fs.atomicWrite('cards/card-a.md', encode(card('card-a', '待做'), ''));
  await fs.atomicWrite('cards/card-b.md', encode(card(bId, '进行中'), ''));
  await fs.atomicWrite('timelog/2026-10-27.md', stringify(segments));
  const repos = createRepos(fs);
  const restored = await restoreRepositories(repos, () => crypto.randomUUID(), () => at), published: Snapshot[] = [];
  const ctx = createContext({ repos, settings: restored.settings, id: () => crypto.randomUUID(), now: () => at,
    log: async () => {}, reminders: { update: async () => {} }, publish: value => { published.push(value); } });
  await reconcile(ctx);
  expect(published).toHaveLength(1);
  const home = published[0].home;
  expect(home).toMatchObject({ mode: 'task', card: { id: bId, status: '进行中' }, awayActivity: '厕所',
    closedEffectiveMs: 27715, currentSegStartedAt: null, activity: { kind: 'away', startedAt: awayAt } });
  expect(cardView(home, Date.parse(at))?.elapsedMs).toBe(27715);
  expect(cardView(home, Date.parse(at) + 60000)?.elapsedMs).toBe(27715);
});
