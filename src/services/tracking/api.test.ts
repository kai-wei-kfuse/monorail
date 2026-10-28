import { expect, it } from 'vitest';
import { activeRefInTx, insertInTx, pauseInTx, resumeInTx, startRefInTx, stopRefInTx, refElapsedInTx, retagRefInTx } from './api';
import type { TrackingTransaction, EntryTemplate } from './api';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 28, 0, minute)).toISOString();
const template: EntryTemplate = { description: 'work', project: '学习', tags: [], card_id: null };
it('nested pause/insert retains only one return target, with caller-supplied current metadata on resume', () => {
  let minute = 0;
  const tx: TrackingTransaction = { scope: 'transaction', get at() { return at(minute); }, now: () => at(minute),
    id: () => crypto.randomUUID(), settings: { dayBoundaryHour: 4 }, entries: [],
    state: { open_entry: null, open_entry_day: null, resume_entry_id: null } };
  startRefInTx(tx, 'card', template);
  minute = 10; pauseInTx(tx);
  const target = tx.state.resume_entry_id;
  minute = 11; insertInTx(tx, { ...template, description: 'wc', project: '生活' });
  minute = 12; pauseInTx(tx);
  expect(tx.state.resume_entry_id).toBe(target); expect(activeRefInTx(tx)).toBe('card');
  minute = 15; resumeInTx(tx, { ...template, description: 'new title', project: '工作', tags: ['new'], card_id: 'card' });
  expect(tx.entries.find(entry => entry.id === tx.state.open_entry)).toMatchObject({ description: 'new title', project: '工作', tags: ['new'] });
  minute = 20; expect(refElapsedInTx(tx, 'card')).toBe(15 * 60000);
  retagRefInTx(tx, 'card', '运动', ['run']);
  expect(tx.entries.find(entry => entry.id === target)?.project).toBe('学习');
  stopRefInTx(tx, 'card');
  expect(activeRefInTx(tx)).toBeNull(); expect(tx.state.resume_entry_id).toBeNull();
  expect(tx.entries.filter(entry => entry.ended_at === null)).toHaveLength(1);
});
