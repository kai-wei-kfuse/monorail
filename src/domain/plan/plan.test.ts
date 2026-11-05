import { describe, expect, it } from 'vitest';
import type { Card } from '../card/card';
import type { Task } from '../task/task';
import type { TimeEntry } from '../timeline/entry';
import { achieved, carryItems, defaultTodayMinutes, dueOn, emptyPlan, minutesOnDay, shiftDay, startedBeforeDay, visibleItems, workable } from './plan';
import type { DayPlan, PlanItem } from './plan';

const B = 4;   // dayBoundaryHour
const local = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();
const task = (over: Partial<Task> = {}): Task => ({ id: 't1', name: '学 Rust', slot: '主线', slot_index: 1, status: '进行中', created_at: local(1, 9), bet_ends_at: null, default_project: null, ...over });
const card = (over: Partial<Card> = {}): Card => ({ id: 'c1', source_record_id: null, content: '读第 4 章', created_at: local(1, 9), due_at: null, blocking: false,
  task_id: 't1', project: '学习', tags: [], status: '待做', type: '时间盒卡', order: 1, timebox_minutes: 120, no_shrink: false, shrunk_from: null,
  shrink_level: 0, continued_from: null, skip_count: 0, completed_at: null, completed_day: null, completed_track: null, progress_note: '', ...over });
const entry = (start: string, end: string | null, over: Partial<TimeEntry> = {}): TimeEntry => ({ id: `e${start}`, started_at: start, ended_at: end,
  description: '读第 4 章', project: '学习', tags: [], card_id: 'c1', kind: '普通', source: '计时', updated_at: start, ...over });
const item = (over: Partial<PlanItem> = {}): PlanItem => ({ card_id: 'c1', priority: '普通', today_minutes: 60, added_at: local(4, 22), carried: false, ...over });
const plan = (day: string, items: PlanItem[]): DayPlan => ({ ...emptyPlan(day), items });

describe('今日任务板的纯规则（ADR 0021 第 1、6 条）', () => {
  it('shiftDay 按日历日期前后挪，跨月也对', () => {
    expect(shiftDay('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('今天已计按活动日切开：凌晨 3 点算前一天，开着的算到 at', () => {
    const entries = [entry(local(5, 2), local(5, 3)), entry(local(5, 9), local(5, 9, 40)), entry(local(5, 10), null)];
    expect(minutesOnDay(entries, 'c1', '2026-11-04', B, local(5, 10, 20))).toBe(60);
    expect(minutesOnDay(entries, 'c1', '2026-11-05', B, local(5, 10, 20))).toBe(60);
  });

  it('今日达成：卡完成，或时间盒今天计够了；结果卡只看完成', () => {
    expect(achieved(item({ today_minutes: 60 }), card(), 59)).toBe(false);
    expect(achieved(item({ today_minutes: 60 }), card(), 60)).toBe(true);
    expect(achieved(item({ today_minutes: null }), card({ type: '结果卡', timebox_minutes: null }), 500)).toBe(false);
    expect(achieved(item({ today_minutes: null }), card({ status: '已完成' }), 0)).toBe(true);
  });

  it('离开背包的卡不显示（派生过滤，不写盘）；完成的留着；任务解冻后又出现', () => {
    const p = plan('2026-11-05', [item(), item({ card_id: 'c2' }), item({ card_id: 'c3' })]);
    const cards = [card(), card({ id: 'c2', status: '已放弃' }), card({ id: 'c3', status: '已完成' })];
    expect(visibleItems(p, cards, [task()]).map(i => i.card_id)).toEqual(['c1', 'c3']);
    expect(visibleItems(p, cards, [task({ status: '冷藏' })]).map(i => i.card_id)).toEqual(['c3']);
    expect(workable(card(), [task({ status: '冷藏' })])).toBe(false);
    expect(workable(card(), [task()])).toBe(true);
  });

  it('只标那天到期的', () => {
    expect(dueOn(card({ due_at: local(5, 20) }), '2026-11-05', B)).toBe(true);
    expect(dueOn(card({ due_at: local(6, 2) }), '2026-11-05', B)).toBe(true);   // 次日凌晨 2 点仍属 11-05 活动日
    expect(dueOn(card({ due_at: local(4, 20) }), '2026-11-05', B)).toBe(false);
  });

  it('真的跨过换日时间才算：同一天重启时不成立', () => {
    expect(startedBeforeDay(entry(local(5, 23), null), '2026-11-06', B)).toBe(true);
    expect(startedBeforeDay(entry(local(6, 9), null), '2026-11-06', B)).toBe(false);
  });

  it('带过去：没达成的带、保留优先级、量取较小；达成的、离开背包的、今天已排的、时间盒已满的不带', () => {
    const source = plan('2026-11-05', [
      item({ card_id: 'c1', priority: '高', today_minutes: 90 }),     // 计了 30，剩 90 → min(90, 90)
      item({ card_id: 'c2', today_minutes: 30 }),                      // 今天计够了：达成，不带
      item({ card_id: 'c3', today_minutes: null }),                    // 结果卡，没完成：带
      item({ card_id: 'c4' }),                                         // 已放弃：不带
      item({ card_id: 'c5', today_minutes: 60 }),                      // 今天已经排了：不带
      item({ card_id: 'c6', today_minutes: 60 }),                      // 总时长已满：不带
    ]);
    const cards = [card(), card({ id: 'c2' }), card({ id: 'c3', type: '结果卡', timebox_minutes: null }), card({ id: 'c4', status: '已放弃' }),
      card({ id: 'c5' }), card({ id: 'c6', timebox_minutes: 60 })];
    const entries = [entry(local(5, 9), local(5, 9, 30)), entry(local(5, 10), local(5, 10, 30), { card_id: 'c2' }),
      entry(local(3, 9), local(3, 10), { card_id: 'c6' })];
    const today = plan('2026-11-06', [item({ card_id: 'c5' })]);
    const carried = carryItems({ source, today, cards, tasks: [task()], entries, boundaryHour: B, at: local(6, 8) });
    expect(carried).toEqual([
      { card_id: 'c1', priority: '高', today_minutes: 90, added_at: local(6, 8), carried: true },
      { card_id: 'c3', priority: '普通', today_minutes: null, added_at: local(6, 8), carried: true },
    ]);
  });

  it('带过去时来源填的量比剩下的多，取剩下的', () => {
    const source = plan('2026-11-05', [item({ today_minutes: 120 })]);
    const carried = carryItems({ source, today: plan('2026-11-06', []), cards: [card()], tasks: [task()],
      entries: [entry(local(5, 9), local(5, 10, 30))], boundaryHour: B, at: local(6, 8) });
    expect(carried[0].today_minutes).toBe(30);
  });

  it('排进今天默认填剩下的时长（向上取 5 分钟，至少 5）；结果卡不填', () => {
    expect(defaultTodayMinutes(card(), 18)).toBe(105);
    expect(defaultTodayMinutes(card(), 119)).toBe(5);
    expect(defaultTodayMinutes(card({ type: '结果卡', timebox_minutes: null }), 0)).toBeNull();
  });
});
