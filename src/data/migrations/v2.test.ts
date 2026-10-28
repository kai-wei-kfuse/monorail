import { expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { MemoryFs } from '../memoryFs';
import { encode, decode } from '../frontmatter';
import { migrateV2 } from './v2';
import { initialState } from './v1/stateRepo';
import { defaults } from './v1/settings';
import { StateRepo } from './v1/stateRepo';
import { cardSchema } from './v1/schemas';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 28, 0, minute)).toISOString();
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];
const row = (id: string, seq: number, start: number, end: number | null, extra = {}) => ({ id, seq, started_at: at(start), ended_at: end === null ? null : at(end), activity: 'work', category: '支线', card_id: 'c', kind: '普通', source: '手动', resume_card_id: null, ...extra });
const card = { id: 'c', source_record_id: null, content: 'card', created_at: at(0), due_at: null, blocking: false, project_id: null,
  status: '进行中', type: '结果卡', order: 1, timebox_minutes: null, no_shrink: false, shrunk_from: null, shrink_level: 0,
  continued_from: null, skip_count: 2, completed_at: null, completed_day: null, completed_track: null, progress_note: '' };
async function fixture(covered = false) {
  const fs = new MemoryFs();
  const segments = covered ? [row(ids[0], 1, 0, 0), row(ids[1], 2, 0, null, { card_id: null, kind: '插入', resume_card_id: 'c', category: '生活' })]
    : [row(ids[0], 1, 0, null), row(ids[1], 2, 10, 20, { card_id: null, category: '生活', source: '补记' })];
  const open = covered ? ids[1] : ids[0];
  await fs.atomicWrite('state.yaml', stringify({ ...initialState, current_card: 'c', home_mode: 'task', open_segment: open, open_segment_day: '2026-10-28', max_seq: 2 }));
  await fs.atomicWrite('settings.yaml', stringify(defaults));
  await fs.atomicWrite('cards/c.md', encode(card, 'keep body'));
  await fs.atomicWrite('reviews/2026-W44.md', encode({ id: '2026-W44', period: '2026-W44', status: '已完成', step: 'done', timer_segment_id: ids[0] }, 'keep review'));
  await fs.atomicWrite('timelog/2026-10-28.md', stringify(segments));
  await fs.atomicWrite('attachments/a/file.txt', 'attachment');
  await fs.atomicWrite('extra/user-note.md', 'preserve custom file');
  return fs;
}
it('migrates once, preserves old effective totals, splits IDs, restores the open tail, and backs up all business files', async () => {
  const fs = await fixture(), result = await migrateV2(fs, { now: at(30), id: () => crypto.randomUUID() });
  expect(result.migrated).toBe(true);
  const state = parse((await fs.read('state.yaml'))!.text);
  expect(state).toMatchObject({ schemaVersion: 2, open_entry: ids[0], pending_at: null, pending_id: null });
  expect(state).not.toHaveProperty('max_seq');
  const entries = (await fs.list('timelog')).flatMap(path => path).length;
  expect(entries).toBe(1);
  const rows = parse((await fs.read('timelog/2026-10-28.md'))!.text);
  expect(new Set(rows.map((row: { id: string }) => row.id)).size).toBe(3);
  expect(rows.find((row: { id: string }) => row.id === ids[0])).toMatchObject({ ended_at: null, started_at: at(20), project: '未分类' });
  expect(decode((await fs.read('cards/c.md'))!.text, 'card')).toMatchObject({ meta: { task_id: 'task-c', status: '进行中' }, body: 'keep body' });
  expect(await fs.read('tasks/task-c.md')).not.toBeNull();
  expect((await fs.read(`${result.backup}/extra/user-note.md`))?.text).toBe('preserve custom file');
  expect(await fs.list(`${result.backup}/attachments`)).toEqual([]);
  expect((await fs.read('attachments/a/file.txt'))?.text).toBe('attachment');
  expect((await migrateV2(fs, { now: at(31), id: () => crypto.randomUUID() })).migrated).toBe(false);
});
it('clears fully covered review/return references and records the sole allowed card status change', async () => {
  const fs = await fixture(true), result = await migrateV2(fs, { now: at(30), id: () => crypto.randomUUID() });
  expect(parse((await fs.read('state.yaml'))!.text)).toMatchObject({ resume_entry_id: null, current_card: null });
  expect(decode((await fs.read('cards/c.md'))!.text, 'card').meta.status).toBe('待做');
  expect(decode((await fs.read('reviews/2026-W44.md'))!.text, 'review')).toMatchObject({ meta: { timer_entry_id: null, status: '已完成' }, body: 'keep review' });
  expect(result.changes).toHaveLength(3);
  expect((await fs.read(`${result.backup}/迁移记录.md`))?.text).toContain('进行中 -> 待做');
});
it('recovers after every write boundary without a mixed schema or overwritten backup', async () => {
  const sample = await fixture(); let count = 0;
  sample.beforeWrite = () => { count++; };
  await migrateV2(sample, { now: at(30), id: () => crypto.randomUUID() });
  for (let failAt = 1; failAt <= count; failAt++) {
    const fs = await fixture(); let writes = 0;
    fs.beforeWrite = () => { if (++writes === failAt) throw new Error(`crash ${failAt}`); };
    await expect(migrateV2(fs, { now: at(30), id: () => crypto.randomUUID() })).rejects.toThrow('crash');
    fs.beforeWrite = undefined;
    await migrateV2(fs, { now: at(30), id: () => crypto.randomUUID() });
    expect(parse((await fs.read('state.yaml'))!.text).schemaVersion).toBe(2);
    expect((await fs.list('.journal')).length).toBe(0);
    const history = parse((await fs.read('timelog/2026-10-28.md'))!.text);
    expect(history.every((entry: Record<string, unknown>) => 'description' in entry && !('seq' in entry))).toBe(true);
  }
});
it.each(['old task', 'journal'])('recovers when deletion fails at %s', async phase => {
  const fs = await fixture();
  await fs.atomicWrite('projects/work.md', encode({ id: 'work', name: 'work', slot: '主线', slot_index: 1,
    status: '进行中', created_at: at(0), bet_ends_at: null }, ''));
  const remove = fs.remove.bind(fs); let failed = false;
  fs.remove = async path => {
    if (!failed && (phase === 'old task' ? path === 'projects/work.md' : path.startsWith('.journal/'))) {
      failed = true; throw new Error('delete interrupted');
    }
    await remove(path);
  };
  await expect(migrateV2(fs, { now: at(30), id: () => crypto.randomUUID() })).rejects.toThrow('delete interrupted');
  await migrateV2(fs, { now: at(30), id: () => crypto.randomUUID() });
  expect(parse((await fs.read('state.yaml'))!.text).schemaVersion).toBe(2);
  expect(await fs.read('projects/work.md')).toBeNull(); expect(await fs.read('tasks/work.md')).not.toBeNull();
  expect(await fs.list('.journal')).toEqual([]);
});
it('restores byte-identical v1 business data from backup and the frozen reader accepts it', async () => {
  const fs = await fixture(), originals = new Map<string, string>();
  for (const path of await fs.list('')) originals.set(path, (await fs.read(path))!.text);
  const result = await migrateV2(fs, { now: at(30), id: () => crypto.randomUUID() }), restored = new MemoryFs();
  for (const [path, text] of originals) {
    const copy = path.startsWith('attachments/') ? (await fs.read(path))!.text : (await fs.read(`${result.backup}/${path}`))!.text;
    expect(copy).toBe(text); await restored.atomicWrite(path, copy);
  }
  expect((await new StateRepo(restored).read()).schemaVersion).toBe(1);
  expect(cardSchema.parse(decode((await restored.read('cards/c.md'))!.text, 'card').meta).status).toBe('进行中');
});
