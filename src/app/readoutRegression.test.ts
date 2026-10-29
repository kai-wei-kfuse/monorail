import { stringify } from 'yaml';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
import { MiniWindow } from './shell/MiniWindow';
import { QuickBar } from '../pages/quickbar/QuickBar';
import { InlineInput } from '../ui/controls/InlineInput';
import { cardView } from '../pages/home/HomePage';

it('migrates a restart snapshot with B away without counting A or the interruption', async () => {
  const fs = new MemoryFs(), bId = 'card-b';
  const start = '2026-10-27T02:27:00.000Z';
  const time = (ms: number) => new Date(Date.parse(start) + ms).toISOString();
  const id = (seq: number) => `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  const awayAt = time(94744), at = time(150000);
  const card = (id: string, status: '待做' | '进行中') => ({ id, source_record_id: null, content: id, created_at: start,
    due_at: null, blocking: false, project_id: null, status, type: '结果卡', order: 1, timebox_minutes: null,
    no_shrink: false, shrunk_from: null, shrink_level: 0, continued_from: null, skip_count: 0,
    completed_at: null, completed_day: null, completed_track: null, progress_note: '' });
  const row = (seq: number, from: number, to: number | null, extra: Partial<Segment> = {}): Segment => ({
    id: id(seq), seq, started_at: time(from), ended_at: to === null ? null : time(to),
    activity: 'A', category: '工作', card_id: 'card-a', kind: '普通', source: '手动', resume_card_id: null, ...extra,
  });
  const away = (cardId: string): Partial<Segment> => ({ activity: '厕所', category: '生活', card_id: null, kind: '插入', resume_card_id: cardId });
  // 不同的时长避免漏计 B 与误计其他片段时相互抵消。
  const segments: Segment[] = [
    row(1, 0, 41001),
    row(2, 41001, 46004, away('card-a')),
    row(3, 46004, 53011),
    row(4, 53011, 64022, { activity: '其他', category: '生活', card_id: null }),
    row(5, 64022, 76023, { activity: 'B', card_id: bId }),
    row(6, 76023, 79030, away(bId)),
    row(7, 79030, 94744, { activity: 'B', card_id: bId }),
    row(8, 94744, null, away(bId)),
  ];
  await fs.atomicWrite('settings.yaml', stringify(defaults));
  await fs.atomicWrite('state.yaml', stringify({ ...initialState, max_seq: 8, current_card: bId,
    open_segment: id(8), open_segment_day: '2026-10-27', home_mode: 'task' }));
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

it('renders MiniWindow inline title input and tiny compact layout without dialog popup', () => {
  const baseProps = { strip: '—', meta: '记到 学习', title: '尝试使用Runner', stateEn: 'RUNNING', digits: '38:59',
    miniFilled: 10, running: true, topoDepth: 0, paused: false, canResume: false,
    onPause: () => {}, onResume: () => {}, onClose: () => {}, onTitle: () => {} };
  const normalHtml = renderToStaticMarkup(createElement(MiniWindow, { ...baseProps, mode: 'mini',
    titleInput: createElement(InlineInput, { id: 'mini-name', className: 'mini-title-in', value: '尝试使用Runner', onChange: () => {}, onDone: () => {} }) }));
  expect(normalHtml).toContain('class="miniwin"');
  expect(normalHtml).toContain('class="inline-in mini-title-in"');
  expect(normalHtml).toContain('记到 学习');
  expect(normalHtml).not.toContain('mini-edit');
  const tinyHtml = renderToStaticMarkup(createElement(MiniWindow, { ...baseProps, mode: 'tiny' }));
  expect(tinyHtml).toContain('class="miniwin tiny"');
  expect(tinyHtml).not.toContain('记到 学习');
  expect(tinyHtml).not.toContain('RUNNING');
  expect(tinyHtml).not.toContain('mbars');
  const qbHtml = renderToStaticMarkup(createElement(QuickBar, { tasks: [], onSave: async () => {}, onHide: () => {} }));
  expect(qbHtml).toContain('class="qb" data-tauri-drag-region="true"');
  expect(qbHtml).toContain('class="qb-fields" data-tauri-drag-region="true"');
});
