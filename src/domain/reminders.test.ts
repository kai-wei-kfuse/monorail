import { describe, it, expect } from 'vitest';
import { planReminders } from './reminders';
import type { Card } from './card/card';
import type { Segment } from './timeline/segment';

const card = (id: string, status: Card['status'], due_at: string | null): Card => ({
  id, source_record_id: null, content: id, created_at: '2026-10-27T00:00:00Z', due_at, blocking: false, project_id: null,
  status, type: '结果卡', order: 0, timebox_minutes: null, no_shrink: false, shrunk_from: null, shrink_level: 0,
  continued_from: null, skip_count: 0, completed_at: null, completed_day: null, completed_track: null, progress_note: '',
});
const open: Segment = { id: 's1', seq: 1, started_at: '2026-10-27T08:00:00Z', ended_at: null, activity: '学 Python',
  category: '主线', card_id: null, kind: '普通', source: '手动', resume_card_id: null };
const base = { deadlineLeadMinutes: 60, longActivityMinutes: 240 };

describe('planReminders', () => {
  it('reminds open cards before their deadline and skips finished ones', () => {
    const plans = planReminders({ ...base, open: null, cards: [
      card('a', '待做', '2026-10-27T12:00:00Z'), card('b', '已完成', '2026-10-27T12:00:00Z'),
      card('c', '已放弃', '2026-10-27T12:00:00Z'), card('d', '待做', null),
    ] });
    expect(plans).toEqual([{ id: 'deadline:a:2026-10-27T12:00:00Z:60', at: Date.parse('2026-10-27T11:00:00Z'), title: '待办期限提醒', body: 'a' }]);
  });
  it('arms one long-activity reminder per open segment', () => {
    const [plan] = planReminders({ ...base, open, cards: [] });
    expect(plan.id).toBe('long:s1:2026-10-27T08:00:00Z:240');
    expect(plan.at).toBe(Date.parse('2026-10-27T12:00:00Z'));
  });
  it('changing a deadline produces a new id so it is delivered again', () => {
    const one = planReminders({ ...base, open: null, cards: [card('a', '待做', '2026-10-27T12:00:00Z')] })[0];
    const two = planReminders({ ...base, open: null, cards: [card('a', '待做', '2026-10-28T12:00:00Z')] })[0];
    expect(one.id).not.toBe(two.id);
  });
});
