import { describe, it, expect } from 'vitest';
import { planReminders } from './reminders';
import type { Card } from './card/card';
import type { TimeEntry } from './timeline/entry';

const card = (id: string, status: Card['status'], due_at: string | null): Card => ({
  id, source_record_id: null, content: id, created_at: '2026-10-27T00:00:00Z', due_at, blocking: false, task_id: null, project: null, tags: [],
  status, type: '结果卡', order: 0, timebox_minutes: null, no_shrink: false, shrunk_from: null, shrink_level: 0,
  continued_from: null, skip_count: 0, completed_at: null, completed_day: null, completed_track: null, progress_note: '',
});
const open: TimeEntry = { id: 's1', started_at: '2026-10-27T08:00:00Z', ended_at: null, description: '学 Python',
  project: '主线', card_id: null, kind: '普通', source: '手动', tags: [], updated_at: '2026-10-27T08:00:00Z' };
const base = { deadlineLeadMinutes: 60, longActivityMinutes: 240 };

describe('planReminders', () => {
  it('reminds open cards before their deadline and skips finished ones', () => {
    const plans = planReminders({ ...base, open: null, cards: [
      card('a', '待做', '2026-10-27T12:00:00Z'), card('b', '已完成', '2026-10-27T12:00:00Z'),
      card('c', '已放弃', '2026-10-27T12:00:00Z'), card('d', '待做', null),
    ] });
    expect(plans).toEqual([{ id: 'deadline:a:2026-10-27T12:00:00Z:60', at: Date.parse('2026-10-27T11:00:00Z'), title: '待办期限提醒', body: 'a' }]);
  });
  it('arms one long-activity reminder per open entry', () => {
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

describe('今天的量到了（0.3.1，已定 49 提议 3）', () => {
  const run: TimeEntry = { ...open, card_id: 'tb' };
  const goal = { cardId: 'tb', day: '2026-10-27', todayMinutes: 60, minutesToday: 20, dayStart: Date.parse('2026-10-27T00:00:00Z') };
  it('正在计的时间盒卡：在「开始 + 还差的分钟」时提醒一次', () => {
    const plan = planReminders({ ...base, cards: [card('tb', '进行中', null)], open: run, todayGoal: goal }).find(p => p.id.startsWith('todayGoal:'));
    expect(plan).toMatchObject({ at: Date.parse(run.started_at) + 40 * 60_000, title: '今天的量到了' });
  });
  it('跨夜一直在计：从今天活动日起点算（G5 审核 S3）', () => {
    const overnight: TimeEntry = { ...run, started_at: '2026-10-26T22:00:00Z' };
    const plan = planReminders({ ...base, cards: [], open: overnight, todayGoal: { ...goal, minutesToday: 0 } }).find(p => p.id.startsWith('todayGoal:'));
    expect(plan?.at).toBe(goal.dayStart + 60 * 60_000);
  });
  it('今天已经计够、或开着的不是这张卡：不提醒', () => {
    expect(planReminders({ ...base, cards: [], open: run, todayGoal: { ...goal, minutesToday: 60 } }).some(p => p.id.startsWith('todayGoal:'))).toBe(false);
    expect(planReminders({ ...base, cards: [], open, todayGoal: goal }).some(p => p.id.startsWith('todayGoal:'))).toBe(false);
  });
});
