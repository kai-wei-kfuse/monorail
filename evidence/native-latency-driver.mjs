// Synthetic, isolated benchmark driver. Bundled twice against captured baseline and current source.
import { tauriFs } from '../src/data/fs.ts';
import { createRepos } from '../src/data/repos.ts';
import { initialState } from '../src/data/stateRepo.ts';
import { cardSchema, taskSchema, recordSchema, reviewSchema } from '../src/data/schemas.ts';
import { defaults } from '../src/shared/settings.ts';
import { activityDay } from '../src/domain/timeline/day.ts';
import { createRecord } from '../src/domain/record/record.ts';
import { convert } from '../src/domain/record/convert.ts';
import { createContext } from '../src/services/commit.ts';
import { startPreset } from '../src/services/homeService.ts';

let active = null;
for (const schema of [cardSchema, taskSchema, recordSchema, reviewSchema]) {
  const parse = schema.parse;
  schema.parse = (...args) => { if (active) active.entityParses++; return parse(...args); };
}

export async function measureVariant(variant, root, size) {
  const fs = await tauriFs(root), repos = createRepos(fs), settings = structuredClone(defaults);
  settings.sideTasks = 30;
  settings.lists.presets = ['a', 'b'].map(id => ({ id, name: `Benchmark ${id}`, project: '生活', tags: [], mode: '插入', place: '弹层' }));
  const at = new Date().toISOString(), before = new Date(Date.now() - 60_000).toISOString();
  const tasks = Array.from({ length: size.tasks }, (_, i) => ({ id: `task-${i}`, name: `Task ${i}`, slot: i ? '支线' : '主线',
    slot_index: i + 1, status: '进行中', default_project: '工作', created_at: at, bet_ends_at: null }));
  const makeRecord = (kind, i) => createRecord({ id: crypto.randomUUID(), text: `Synthetic ${i} #benchmark`, kind,
    created_at: at, due_at: null, blocking: false, task_id: null, card_id: null, tags: [], attachments: [] });
  const cards = Array.from({ length: size.cards }, (_, i) => ({ ...convert(makeRecord('待办', i), i),
    id: `card-${i}`, source_record_id: null, task_id: tasks[i % tasks.length].id }));
  const records = Array.from({ length: size.records }, (_, i) => makeRecord('想法', i));
  const reviews = Array.from({ length: size.reviews }, (_, i) => ({ id: `2026-W${String(i + 1).padStart(2, '0')}`,
    period: `2026-W${String(i + 1).padStart(2, '0')}`, status: '已完成', step: 'done', done: ['recap', 'newIdeas', 'arena', 'coldPick', 'bet'],
    started_at: before, completed_at: at, added_idea_ids: [], bet_task_ids: [], bet_done_ids: [], cold_duel: null, timer_entry_id: null }));
  const entry = { id: crypto.randomUUID(), description: 'Benchmark base', project: '工作', tags: [], card_id: null,
    started_at: before, ended_at: null, kind: '普通', source: '计时', updated_at: at };
  const state = { ...structuredClone(initialState), open_entry: entry.id, open_entry_day: activityDay(before, settings.dayBoundaryHour) };
  const writes = await Promise.all([
    ...tasks.map(value => repos.tasks.write(value, null)), ...cards.map(value => repos.cards.write(value, null)),
    ...records.map(value => repos.records.write(value, null, 'Synthetic benchmark body. '.repeat(12))),
    ...reviews.map(value => repos.reviews.write(value, null)), repos.settings.write(settings), repos.state.write(state),
  ]);
  writes.push(...await repos.times.writes([entry], at, settings.dayBoundaryHour));
  await repos.transact(crypto.randomUUID(), writes);

  const readState = repos.state.read.bind(repos.state);
  repos.state.read = async () => {
    if (active && active.queueEntered === undefined) active.queueEntered = performance.now();
    return readState();
  };
  for (const key of ['cards', 'tasks', 'reviews', 'records']) {
    const list = repos[key].list.bind(repos[key]);
    repos[key].list = async () => {
      const result = await list();
      if (active && ++active.listsFinished === 4) active.readEnded = performance.now();
      return result;
    };
  }
  const transact = repos.transact.bind(repos);
  repos.transact = async (id, plans) => {
    if (active) active.journalStarted = performance.now();
    await transact(id, plans);
    if (active) active.journalEnded = performance.now();
  };
  const ctx = createContext({ repos, settings, id: () => crypto.randomUUID(), now: () => new Date().toISOString(),
    publish: () => { if (active) active.published = performance.now(); },
    log: async () => {}, reminders: { update: async () => {} }, random: () => 0.5 });

  const results = [];
  // One first-read row and five warm rows; "cold" means an empty parse cache, not a flushed OS cache.
  for (let round = 0; round < 6; round++) {
    active = { ipc: {}, entityParses: 0, listsFinished: 0, requested: performance.now() };
    window.__latencyActive = active;
    await startPreset(ctx, round % 2 ? 'b' : 'a', new Date().toISOString());
    const ended = performance.now(), observed = active;
    active = null; window.__latencyActive = null;
    results.push({ variant, size, round, parseCache: round ? 'warm' : 'cold', entityParses: observed.entityParses,
      ipc: observed.ipc, totalMs: ended - observed.requested,
      queueWaitMs: observed.queueEntered - observed.requested,
      readAndParseMs: observed.readEnded - observed.queueEntered,
      prepareWritesMs: observed.journalStarted - observed.readEnded,
      journalMs: observed.journalEnded - observed.journalStarted,
      projectionAndPublishMs: observed.published - observed.journalEnded });
  }
  return results;
}
