// 0.3.0-beta.3 E6：回看的整份结果（任务与来源、完成的卡、做到哪了、主线投入、合计不变量、上一期、按桶筛选）。
import { describe, expect, it } from 'vitest';
import type { Card } from '../card/card';
import type { Task } from '../task/task';
import type { TimeEntry } from '../timeline/entry';
import { computeRecap, sourceOf } from './recap';
import type { RecapInput } from './recap';
import type { RecapQuery } from '../../shared/recap';

const MIN = 60_000, HOUR = 60 * MIN;
const t = (m: number, d: number, h: number, min = 0) => new Date(2026, m - 1, d, h, min).toISOString();
let n = 0;
const e = (start: string, end: string | null, extra: Partial<TimeEntry> = {}): TimeEntry => ({
  id: `e${String(++n).padStart(3, '0')}`, started_at: start, ended_at: end, description: '学习', project: '学习', tags: [], card_id: null,
  kind: '普通', source: '计时', updated_at: end ?? start, ...extra });
const card = (id: string, extra: Partial<Card> = {}): Card => ({
  id, source_record_id: null, content: id, created_at: t(10, 1, 9), due_at: null, blocking: false, task_id: null, project: null, tags: [],
  status: '进行中', type: '结果卡', order: 1, timebox_minutes: null, no_shrink: false, shrunk_from: null, shrink_level: 0, continued_from: null,
  skip_count: 0, completed_at: null, completed_day: null, completed_track: null, progress_note: '', ...extra } as Card);
const task = (id: string, slot: Task['slot']): Task => ({ id, name: `任务${id}`, slot, slot_index: 1, status: '进行中', created_at: t(10, 1, 9), bet_ends_at: null, default_project: null });

const NOW = t(11, 8, 20);
const tasks = [task('M', '主线'), task('S', '支线')];
const cards = [
  card('cm', { task_id: 'M' }), card('cs', { task_id: 'S' }),
  // 完成时是主线，后来任务换到了支线：仍按完成时冻结的主线算
  card('done', { task_id: 'S', status: '已完成', completed_at: t(11, 4, 18), completed_day: '2026-11-04', completed_track: '主线', progress_note: '做完了' }),
  card('noted', { task_id: 'M', progress_note: '下次从第 3 节开始', progress_noted_at: t(11, 6, 22) }),
];
const entries = [
  e(t(11, 3, 9), t(11, 3, 11), { card_id: 'cm', project: '工作', tags: ['a'] }),
  e(t(11, 3, 10), t(11, 3, 12), { card_id: 'cs', project: '学习', tags: ['a', 'b'] }),   // 和上一条并行 1 小时
  e(t(11, 4, 14), t(11, 4, 15), { card_id: 'done', project: '工作' }),
  e(t(11, 4, 15), t(11, 4, 15, 10), { kind: '插入', description: '厕所', project: '生活' }),
  e(t(11, 5, 0), t(11, 5, 7), { project: '睡眠', description: '睡觉' }),
  e(t(11, 5, 6), t(11, 5, 8), { description: '补录：晨跑', project: '运动' }),          // 和睡眠重叠 1 小时
  e(t(11, 6, 9), t(11, 6, 10), { project: '待机', description: '待机' }),
  e(t(10, 28, 9), t(10, 28, 12), { card_id: 'cm', project: '工作' }),                   // 上周
  e(t(11, 8, 19), null, { description: '写周报', project: '工作' }),                   // 正在计时
];
const input = (query: Partial<RecapQuery> = {}, more: Partial<RecapInput> = {}): RecapInput => ({
  entries, cards, tasks, lastReviewAt: t(11, 1, 21), firstUsedDay: '2026-10-01', projectColors: { 工作: '#8f6bff', 学习: '#00b4ff' },
  boundaryHour: 4, asOf: NOW, query: { period: 'week', dim: 'project', includeIdle: false, ...query }, ...more });
const sum = (xs: { ms: number }[]) => xs.reduce((a, b) => a + b.ms, 0);

describe('computeRecap', () => {
  it('有效投入是实际占用：并行只算一次，和睡眠重叠的补录拿全部；不随开关变', () => {
    const off = computeRecap(input()), on = computeRecap(input({ includeIdle: true }));
    // 3 + 1 + 1/6 + 2 + 1（正在计时 19–20）小时
    const expected = 3 * HOUR + HOUR + 10 * MIN + 2 * HOUR + HOUR;
    expect(off.effectiveMs).toBe(expected);
    expect(on.effectiveMs).toBe(expected);
    expect(off.totalMs).toBe(expected);
    expect(on.totalMs).toBe(expected + 7 * HOUR + HOUR - HOUR);   // 加上睡眠 7 小时、待机 1 小时，减去补录与睡眠重叠的分摊
  });
  it('任意维度、任意开关下：各组合计 = 各柱之和 = totalMs；千分比合计 1000', () => {
    for (const dim of ['project', 'tag', 'source', 'activity'] as const) for (const includeIdle of [false, true]) {
      const r = computeRecap(input({ dim, includeIdle }));
      expect(sum(r.groups)).toBe(r.totalMs);
      expect(r.buckets.reduce((a, b) => a + b.totalMs, 0)).toBe(r.totalMs);
      expect(r.groups.reduce((a, g) => a + g.permille, 0)).toBe(1000);
      for (const g of r.groups) expect(sum(g.rows)).toBe(g.ms);
    }
  });
  it('任务与来源四类；已完成的卡用冻结的主线；主线投入千分比', () => {
    const map = new Map(cards.map(c => [c.id, c]));
    expect(entries.slice(0, 4).map(x => sourceOf(x, map, tasks))).toEqual(['主线任务', '支线任务', '主线任务', '临时离开']);
    const r = computeRecap(input({ dim: 'source' }));
    expect(Object.fromEntries(r.groups.map(g => [g.key, g.ms]))).toEqual({
      主线任务: 90 * MIN + HOUR, 支线任务: 90 * MIN, 自由活动: 2 * HOUR + HOUR, 临时离开: 10 * MIN });
    expect(r.mainline.permille).toBe(Math.round((150 * MIN) * 1000 / r.effectiveMs));
  });
  it('完成的卡与做到哪了：按周期过滤，卡的用时只看自己的条目', () => {
    const r = computeRecap(input());
    expect(r.done).toEqual([expect.objectContaining({ id: 'done', track: '主线', task: '任务S', day: '2026-11-04', ms: HOUR })]);
    expect(r.notes.map(x => x.id)).toEqual(['noted', 'done']);
    expect(computeRecap(input({ period: 'lastWeek' })).done).toEqual([]);
  });
  it('上一期：可比时给出每组的上一期时长，没有的标 null（新出现），上一期有本期没有的列在 goneKeys', () => {
    const r = computeRecap(input());
    expect(r.previous).toMatchObject({ label: '上周', comparable: true, effectiveMs: 3 * HOUR, mainPermille: 1000, done: 0 });
    const g = Object.fromEntries(r.groups.map(x => [x.key, x.previousMs]));
    expect(g['工作']).toBe(3 * HOUR);
    expect(g['学习']).toBeNull();
    const old = computeRecap(input({ period: 'year' }));
    expect(old.previous.comparable).toBe(false);
    expect(old.groups.every(x => x.previousMs === undefined)).toBe(true);
  });
  it('按桶筛选：分组只算这一天，颜色沿用整个周期的；不显示增减', () => {
    const whole = computeRecap(input());
    const day = computeRecap(input({ bucket: '2026-11-04' }));
    expect(day.groups.map(x => [x.key, x.ms])).toEqual([['工作', HOUR], ['生活', 10 * MIN]]);
    expect(day.groups[0].color).toBe(whole.groups.find(x => x.key === '工作')!.color);
    expect(day.groups.every(x => x.previousMs === undefined)).toBe(true);
    expect(day.buckets).toEqual(whole.buckets);
  });
  it('具体活动维度一条一行带起止；其他维度按描述合并', () => {
    const act = computeRecap(input({ dim: 'activity' }));
    expect(act.groups.find(g => g.key === '学习')!.rows.every(x => x.count === 1 && x.start !== null)).toBe(true);
    const proj = computeRecap(input());
    expect(proj.groups.find(g => g.key === '工作')!.rows.map(x => [x.key, x.count])).toEqual([['学习', 2], ['写周报', 1]]);
  });
  it('超过 9 项时图表只给前 8 项配色，其余合并成灰色「其他」', () => {
    const many = Array.from({ length: 12 }, (_, i) => e(t(11, 7, 8 + i), t(11, 7, 8 + i, 10 + i), { description: `活动${i}` }));
    const r = computeRecap(input({ dim: 'activity' }, { entries: many }));
    expect(r.series).toHaveLength(9);
    expect(r.series.at(-1)).toMatchObject({ key: '其他', merged: 4, color: '#cfcfc9' });
    expect(r.groups[8].color).toBe('#cfcfc9');
    expect(r.series.reduce((a, s) => a + s.permille, 0)).toBe(1000);
  });
  it('正在计时：asOf 往后推，总数跟着变', () => {
    const later = computeRecap(input({}, { asOf: t(11, 8, 20, 30) }));
    expect(later.effectiveMs - computeRecap(input()).effectiveMs).toBe(30 * MIN);
  });
});
