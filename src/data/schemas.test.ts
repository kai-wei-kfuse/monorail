import { expect, it } from 'vitest';
import { recordSchema, cardSchema, segmentSchema, settingsSchema } from './schemas';
import { defaults } from '../shared/settings';

it('record schema preserves unknown fields and rejects wrong types', () => {
  const value = { id: crypto.randomUUID(), text: 'x', kind: '待办', created_at: '2026-10-27T00:00:00Z', due_at: null, blocking: true, project_id: null, card_id: null, tags: [], attachments: [], external: 'kept' };
  expect(recordSchema.parse(value).external).toBe('kept');
  for (const change of [{ id: '../escape' }, { kind: '稍后看' }, { created_at: 'yesterday' }, { blocking: 'false' }]) expect(recordSchema.safeParse({ ...value, ...change }).success).toBe(false);
});
it('card schema enforces required state and timestamps', () => {
  const id = crypto.randomUUID();
  const value = { id: `card-${id}`, source_record_id: id, content: 'x', created_at: '2026-10-27T00:00:00Z', due_at: null, blocking: false, project_id: null, status: '待做', type: '结果卡', order: 1, completed_at: null, completed_day: null, completed_track: null, progress_note: '' };
  expect(cardSchema.safeParse(value).success).toBe(true);
  expect(cardSchema.safeParse({ ...value, status: 'invalid' }).success).toBe(false);
  expect(cardSchema.safeParse({ ...value, due_at: 'not a timestamp' }).success).toBe(false);
});
it('segment schema rejects invalid sequences and backward time', () => {
  const value = { id: crypto.randomUUID(), seq: 1, started_at: '2026-10-27T01:00:00Z', ended_at: null, activity: 'x', category: '生活', card_id: null, kind: '普通', source: '手动', resume_card_id: null };
  expect(segmentSchema.safeParse(value).success).toBe(true);
  for (const change of [{ seq: 0 }, { seq: 1.5 }, { ended_at: '2026-10-27T00:59:59Z' }]) expect(segmentSchema.safeParse({ ...value, ...change }).success).toBe(false);
});
it('settings schema validates calendar hours and positive reminder duration', () => {
  expect(settingsSchema.safeParse(defaults).success).toBe(true);
  for (const change of [{ dayBoundaryHour: 24 }, { dayBoundaryHour: 1.5 }, { longActivityMinutes: 0 }, { deadlineLeadMinutes: -1 }]) expect(settingsSchema.safeParse({ ...defaults, ...change }).success).toBe(false);
});
