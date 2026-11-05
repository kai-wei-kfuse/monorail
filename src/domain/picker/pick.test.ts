import { describe, expect, it } from 'vitest';
import type { Card } from '../card/card';
import type { Task } from '../task/task';
import type { TimeEntry } from '../timeline/entry';
import { emptyPlan } from '../plan/plan';
import type { DayPlan, PlanItem } from '../plan/plan';
import { drawableOnPlan, pickFromPlan } from './pick';
import type { PickInput } from './pick';

// 抽卡：只从今天的板子里抽（ADR 0021 第 2 条）
const local = (h: number, m = 0) => new Date(2026, 10, 6, h, m).toISOString();
const task = (id: string, slot: Task['slot']): Task => ({ id, name: id, slot, slot_index: 1, status: '进行中', created_at: local(8), bet_ends_at: null, default_project: null });
const card = (id: string, over: Partial<Card> = {}): Card => ({ id, source_record_id: null, content: id, created_at: local(8), due_at: null, blocking: false,
  task_id: 'side', project: null, tags: [], status: '待做', type: '结果卡', order: 1, timebox_minutes: null, no_shrink: false, shrunk_from: null,
  shrink_level: 0, continued_from: null, skip_count: 0, completed_at: null, completed_day: null, completed_track: null, progress_note: '', ...over });
const item = (card_id: string, over: Partial<PlanItem> = {}): PlanItem => ({ card_id, priority: '普通', today_minutes: null, added_at: local(8), carried: false, ...over });
const plan = (items: PlanItem[], over: Partial<DayPlan> = {}): DayPlan => ({ ...emptyPlan('2026-11-06'), items, ...over });
const input = (over: Partial<PickInput>): PickInput => ({ plan: plan([]), cards: [], tasks: [task('main', '主线'), task('side', '支线')], entries: [],
  boundaryHour: 4, at: local(10), activeCard: null, inserting: false, legacyRest: false, random: 0, ...over });

describe('pickFromPlan', () => {
  it('今天没排、也没选先不排：先问', () => {
    expect(pickFromPlan(input({ cards: [card('a')] }))).toEqual({ kind: 'plan' });
  });

  it('这次先不排：从整个背包抽，不看板子', () => {
    const r = pickFromPlan(input({ plan: plan([], { skip_until_planned: true }), cards: [card('a'), card('b', { status: '已完成' })] }));
    expect(r).toMatchObject({ kind: 'task', card: { id: 'a' } });
  });

  it('插入中、旧降级休息没处理：不能抽', () => {
    expect(pickFromPlan(input({ inserting: true }))).toEqual({ kind: 'blocked', reason: 'inserting' });
    expect(pickFromPlan(input({ legacyRest: true }))).toEqual({ kind: 'blocked', reason: 'rest' });
  });

  it('带过来的还没确认：先确认', () => {
    expect(pickFromPlan(input({ plan: plan([item('a', { carried: true })], { carried_confirmed: false }), cards: [card('a')] }))).toEqual({ kind: 'confirmCarry' });
  });

  it('候选去掉：达成的、离开背包的、正在做的；全没了就是今天都做完了', () => {
    const entries: TimeEntry[] = [{ id: 'e', started_at: local(9), ended_at: local(9, 30), description: 't', project: 'p', tags: [], card_id: 't', kind: '普通', source: '计时', updated_at: local(9) }];
    const cards = [card('done', { status: '已完成' }), card('gone', { status: '已放弃' }), card('run', { status: '进行中' }),
      card('t', { type: '时间盒卡', timebox_minutes: 60 })];
    const p = plan([item('done'), item('gone'), item('run'), item('t', { today_minutes: 30 })]);
    expect(drawableOnPlan({ plan: p, cards, tasks: input({}).tasks, entries, boundaryHour: 4, at: local(10), activeCard: 'run' })).toEqual([]);
    expect(pickFromPlan(input({ plan: p, cards, entries, activeCard: 'run' }))).toEqual({ kind: 'done' });
  });

  it('权重 = 优先级（普通 1、高 3）× 主线 1.5', () => {
    // 排序后：m(主线·普通 1.5) s(支线·高 3)；总 4.5，random < 1.5/4.5 出 m
    const cards = [card('m', { task_id: 'main', order: 1 }), card('s', { order: 2 })];
    const p = plan([item('m'), item('s', { priority: '高' })]);
    expect(pickFromPlan(input({ plan: p, cards, random: 0.33 }))).toMatchObject({ card: { id: 'm' } });
    expect(pickFromPlan(input({ plan: p, cards, random: 0.34 }))).toMatchObject({ card: { id: 's' } });
    const r = pickFromPlan(input({ plan: p, cards }));
    expect(r.kind === 'task' && r.candidates.map(c => c.weight)).toEqual([1.5, 3]);
  });

  it('换一张跳过的这一轮不出；全跳过了开新一轮（resetRound，真正清空在写事务里）', () => {
    const cards = [card('a', { order: 1 }), card('b', { order: 2 })];
    expect(pickFromPlan(input({ plan: plan([item('a'), item('b')], { seen: ['a'] }), cards }))).toMatchObject({ card: { id: 'b' }, resetRound: false });
    expect(pickFromPlan(input({ plan: plan([item('a'), item('b')], { seen: ['a', 'b'] }), cards }))).toMatchObject({ card: { id: 'a' }, resetRound: true });
  });

  it('不再看阻塞、快到期、每日底线', () => {
    const cards = [card('a', { order: 1 }), card('urgent', { order: 2, blocking: true, due_at: local(10, 30) })];
    expect(pickFromPlan(input({ plan: plan([item('a'), item('urgent')]), cards, random: 0 }))).toMatchObject({ card: { id: 'a' } });
  });
});
