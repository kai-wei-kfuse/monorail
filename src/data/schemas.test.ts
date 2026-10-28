import { expect, it } from 'vitest';
import { recordSchema, cardSchema, entrySchema, settingsSchema } from './schemas';
import { recordSchema as legacyRecordSchema } from './migrations/v1/schemas';
import { defaults } from '../shared/settings';

it('record schema preserves unknown fields and rejects wrong types', () => {
  const value = { id: crypto.randomUUID(), text: 'x', kind: '待办', created_at: '2026-10-27T00:00:00Z', due_at: null, blocking: true, task_id: null, card_id: null, tags: [], attachments: [], needs: null, pool: null, last_touched_at: '2026-10-27T00:00:00Z', cold_since: null, external: 'kept' };
  expect(recordSchema.parse(value).external).toBe('kept');
  for (const change of [{ id: '../escape' }, { kind: '稍后看' }, { created_at: 'yesterday' }, { blocking: 'false' }]) expect(recordSchema.safeParse({ ...value, ...change }).success).toBe(false);
});
it('migrates known M1 idea records and rejects partial new lifecycle metadata and unsafe attachment paths', () => {
  const legacy = { id: crypto.randomUUID(), text: '旧想法', kind: '想法', created_at: '2026-10-27T00:00:00Z', due_at: null, blocking: false,
    task_id: null, card_id: null, tags: [], attachments: [] };
  const legacyValue = legacyRecordSchema.parse({ ...legacy, project_id: null });
  const value = { ...legacyValue, task_id: null, pool: '活跃池' };
  expect(value).toMatchObject({ needs: null, pool: '活跃池', last_touched_at: legacy.created_at, cold_since: null });
  expect(recordSchema.safeParse({ ...legacy, last_touched_at: legacy.created_at }).success).toBe(false);
  for (const attachment of ['../secret.txt', 'C:/secret.txt', 'attachments/../secret.txt', 'attachments\\x.txt', '/secret']) {
    expect(recordSchema.safeParse({ ...value, attachments: [attachment] }).success).toBe(false);
  }
  expect(recordSchema.safeParse({ ...value, pool: '冷库', cold_since: null }).success).toBe(false);
});
it('card schema enforces required state and timestamps', () => {
  const id = crypto.randomUUID();
  const value = { id: `card-${id}`, source_record_id: id, content: 'x', created_at: '2026-10-27T00:00:00Z', due_at: null, blocking: false, task_id: null, project: null, tags: [], status: '待做', type: '结果卡', order: 1, completed_at: null, completed_day: null, completed_track: null, progress_note: '', timebox_minutes: null, no_shrink: false, shrunk_from: null, shrink_level: 0, continued_from: null, skip_count: 0 };
  expect(cardSchema.safeParse(value).success).toBe(true);
  expect(cardSchema.safeParse({ ...value, status: 'invalid' }).success).toBe(false);
  expect(cardSchema.safeParse({ ...value, due_at: 'not a timestamp' }).success).toBe(false);
});
it('entry schema rejects invalid timestamps and legacy-only fields', () => {
  const value = { id: crypto.randomUUID(), started_at: '2026-10-27T01:00:00Z', ended_at: null, description: 'x', project: '生活', tags: [], card_id: null, kind: '普通', source: '计时', updated_at: '2026-10-27T01:00:00Z' };
  expect(entrySchema.safeParse(value).success).toBe(true);
  for (const change of [{ started_at: 'bad' }, { source: '补记' }, { tags: null }]) expect(entrySchema.safeParse({ ...value, ...change }).success).toBe(false);
});
it('settings schema validates calendar hours and positive reminder duration', () => {
  expect(settingsSchema.safeParse(defaults).success).toBe(true);
  for (const change of [{ dayBoundaryHour: 24 }, { dayBoundaryHour: 1.5 }, { longActivityMinutes: 0 }, { deadlineLeadMinutes: -1 }]) expect(settingsSchema.safeParse({ ...defaults, ...change }).success).toBe(false);
});
