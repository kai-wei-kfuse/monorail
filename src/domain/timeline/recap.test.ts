// 0.3.0-beta.3 E6：回看时间部分的纯函数。时间都是本地时间（测试机时区），日界 4 点。
import { describe, expect, it } from 'vitest';
import type { TimeEntry } from './entry';
import { addDay, allocate, bucketsOf, permilles, previousPeriod, resolvePeriod, splitEvenly, sumByKey, tagKeys, unitFor } from './recap';

const B = 4, MIN = 60_000, HOUR = 60 * MIN;
const t = (m: number, d: number, h: number, min = 0, s = 0, ms = 0) => new Date(2026, m - 1, d, h, min, s, ms).toISOString();
let n = 0;
const e = (start: string, end: string | null, extra: Partial<TimeEntry> = {}): TimeEntry => ({
  id: `e${String(++n).padStart(3, '0')}`, started_at: start, ended_at: end, description: 'x', project: '学习', tags: [], card_id: null,
  kind: '普通', source: '计时', updated_at: end ?? start, ...extra });
const NOW = t(11, 8, 20);   // 2026-11-08 周日 20:00
const ctx = { asOf: NOW, boundaryHour: B };
const sum = (xs: { ms: number }[]) => xs.reduce((a, b) => a + b.ms, 0);

describe('resolvePeriod', () => {
  it('本周、上周、本月、近 3 个月、最近一年按活动日推，今天是 asOf 所在的活动日', () => {
    expect(resolvePeriod('week', ctx)).toMatchObject({ fromDay: '2026-11-02', toDay: '2026-11-08', days: 7 });
    expect(resolvePeriod('lastWeek', ctx)).toMatchObject({ fromDay: '2026-10-26', toDay: '2026-11-01' });
    expect(resolvePeriod('month', ctx)).toMatchObject({ fromDay: '2026-11-01', toDay: '2026-11-08' });
    expect(resolvePeriod('quarter', ctx)).toMatchObject({ fromDay: '2026-08-09', toDay: '2026-11-08', days: 92 });
    expect(resolvePeriod('year', ctx)).toMatchObject({ fromDay: '2025-11-09', toDay: '2026-11-08' });
    // 凌晨 3 点还算前一天
    expect(resolvePeriod('week', { asOf: t(11, 9, 3), boundaryHour: B }).toDay).toBe('2026-11-08');
  });
  it('时刻范围从起始日的日界到结束日的下一个日界；effectiveTo 不超过现在', () => {
    const r = resolvePeriod('week', ctx);
    expect([r.from, r.to, r.effectiveTo]).toEqual([t(11, 2, 4), t(11, 9, 4), NOW]);
  });
  it('月末往前推 3 个月取那个月的月末；自定义起止顺序不限', () => {
    expect(resolvePeriod('quarter', { asOf: t(5, 31, 12), boundaryHour: B }).fromDay).toBe('2026-03-01');
    expect(resolvePeriod('custom', { ...ctx, from: '2026-10-20', to: '2026-10-15' })).toMatchObject({ fromDay: '2026-10-15', toDay: '2026-10-20', days: 6 });
  });
  it('本次回顾周期从上次完成回顾那一刻起算', () => {
    const r = resolvePeriod('cycle', { ...ctx, lastReviewAt: t(10, 31, 21, 40) });
    expect(r).toMatchObject({ fromDay: '2026-10-31', toDay: '2026-11-08', from: t(10, 31, 21, 40), after: t(10, 31, 21, 40) });
  });
  it('跨年', () => {
    expect(resolvePeriod('week', { asOf: t(1, 1, 12), boundaryHour: B })).toMatchObject({ fromDay: '2025-12-29', toDay: '2026-01-01' });
    expect(addDay('2025-12-31', 1)).toBe('2026-01-01');
  });
});

describe('previousPeriod', () => {
  it('紧挨着之前、同样天数；本月对比上月同期，不超过上月末', () => {
    const week = previousPeriod(resolvePeriod('week', ctx), NOW, B, '2025-01-01');
    expect(week).toMatchObject({ label: '上周', comparable: true, range: { fromDay: '2026-10-26', toDay: '2026-11-01' } });
    const march31 = { asOf: t(3, 31, 12), boundaryHour: B };
    expect(previousPeriod(resolvePeriod('month', march31), march31.asOf, B, '2025-01-01').range).toMatchObject({ fromDay: '2026-02-01', toDay: '2026-02-28' });
    expect(previousPeriod(resolvePeriod('month', ctx), NOW, B, '2025-01-01').range).toMatchObject({ fromDay: '2026-10-01', toDay: '2026-10-08' });
  });
  it('上一期早于最早的记录时不可比；没有记录也不可比', () => {
    expect(previousPeriod(resolvePeriod('year', ctx), NOW, B, '2025-11-01').comparable).toBe(false);
    expect(previousPeriod(resolvePeriod('week', ctx), NOW, B, null).comparable).toBe(false);
  });
});

describe('allocate：实际占用时长', () => {
  const week = resolvePeriod('week', ctx);
  it('不含待机 / 睡眠时先过滤：和睡眠重叠的补录拿到全部时长', () => {
    const sleep = e(t(11, 3, 0), t(11, 3, 2), { project: '睡眠' }), late = e(t(11, 3, 1), t(11, 3, 2));
    expect(sum(allocate([sleep, late], week, NOW, B, false))).toBe(HOUR);
    const both = allocate([sleep, late], week, NOW, B, true);
    expect(sum(both)).toBe(2 * HOUR);
    expect(both.find(s => s.entry.id === late.id)!.ms).toBe(30 * MIN);
  });
  it('三条部分重叠：总数等于并集，重叠段平均分', () => {
    const a = e(t(11, 3, 9), t(11, 3, 11)), b = e(t(11, 3, 10), t(11, 3, 12)), c = e(t(11, 3, 10, 30), t(11, 3, 11, 30));
    const shares = allocate([a, b, c], week, NOW, B, false);
    expect(sum(shares)).toBe(3 * HOUR);
    const of = (x: TimeEntry) => shares.find(s => s.entry.id === x.id)!.ms;
    // a：9–10 独占 60 + 10–10:30 与 b 各 15 + 10:30–11 三条各 10 = 85；b：15 + 10 + 11–11:30 与 c 各 15 + 11:30–12 独占 30 = 70；c：10 + 15 = 25
    expect([of(a), of(b), of(c)]).toEqual([85 * MIN, 70 * MIN, 25 * MIN]);
  });
  it('跨日的并行段按活动日切开再分', () => {
    const a = e(t(11, 4, 2), t(11, 4, 6)), b = e(t(11, 4, 3), t(11, 4, 5));
    const shares = allocate([a, b], week, NOW, B, false);
    const day = (d: string) => sum(shares.filter(s => s.day === d));
    expect([day('2026-11-03'), day('2026-11-04')]).toEqual([2 * HOUR, 2 * HOUR]);
  });
  it('整数毫秒、确定次序的余数：1000 毫秒分 3 条，1 毫秒段', () => {
    const s = t(11, 5, 9), end = t(11, 5, 9, 0, 1);
    const xs = [e(s, end, { id: 'b' }), e(s, end, { id: 'a' }), e(s, end, { id: 'c' })];
    expect(allocate(xs, week, NOW, B, false).map(x => [x.entry.id, x.ms])).toEqual([['a', 334], ['b', 333], ['c', 333]]);
    const one = [e(s, t(11, 5, 9, 0, 0, 1), { id: 'y' }), e(s, t(11, 5, 9, 0, 0, 1), { id: 'x' })];
    expect(allocate(one, week, NOW, B, false).map(x => [x.entry.id, x.ms])).toEqual([['x', 1]]);
  });
  it('同一组输入换顺序，结果相同', () => {
    const xs = Array.from({ length: 12 }, (_, i) => { const s = Date.parse(t(11, 6, 8 + (i % 5), i * 7 % 60));
      return e(new Date(s).toISOString(), new Date(s + (31 + i * 13 % 90) * MIN + i * 7).toISOString()); });
    const forward = allocate(xs, week, NOW, B, false), backward = allocate([...xs].reverse(), week, NOW, B, false);
    expect(backward.map(s => [s.entry.id, s.day, s.ms])).toEqual(forward.map(s => [s.entry.id, s.day, s.ms]));
  });
  it('晚于现在的条目（时钟被往回调过）不让回看报错：开始晚于现在的不算，结束晚于现在的截到现在', () => {
    const future = e(t(11, 8, 21), t(11, 8, 22)), straddle = e(t(11, 8, 19, 30), t(11, 8, 21));
    expect(allocate([future, straddle], week, NOW, B, false).map(s => [s.entry.id, s.ms])).toEqual([[straddle.id, 30 * MIN]]);
  });
  it('正在计时的以 asOf 为终点；周期外的部分裁掉', () => {
    const run = e(t(11, 8, 19), null), before = e(t(11, 1, 23), t(11, 2, 6));
    const shares = allocate([run, before], week, NOW, B, false);
    expect(shares.find(s => s.entry.id === run.id)!.ms).toBe(HOUR);
    expect(shares.find(s => s.entry.id === before.id)!.ms).toBe(2 * HOUR);
  });
});

describe('分桶、按键累加、千分比', () => {
  it('≤ 16 天按日，17–100 天按周，> 100 天按月', () => {
    expect([unitFor(16), unitFor(17), unitFor(100), unitFor(101)]).toEqual(['day', 'week', 'week', 'month']);
    const q = resolvePeriod('quarter', ctx), weeks = bucketsOf(q, 'week');
    expect(weeks[0]).toMatchObject({ id: 'W:2026-08-03', label: '08.09', days: ['2026-08-09'] });
    expect(weeks.at(-1)!.days).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
    expect(bucketsOf(resolvePeriod('year', ctx), 'month').map(b => b.id).slice(0, 2)).toEqual(['M:2025-11', 'M:2025-12']);
  });
  it('多标签 1 / n 分摊，余数按标签名；无标签归「无标签」', () => {
    const week = resolvePeriod('week', ctx);
    const tagged = e(t(11, 3, 9), t(11, 3, 9, 0, 0, 10), { tags: ['b', 'a', 'c'] }), plain = e(t(11, 3, 10), t(11, 3, 10, 1));
    const groups = sumByKey(allocate([tagged, plain], week, NOW, B, false), tagKeys);
    expect([...groups].map(([k, g]) => [k, g.ms])).toEqual([['#a', 4], ['#b', 3], ['#c', 3], ['无标签', MIN]]);
  });
  it('千分比合计正好 1000；全为 0 时都是 0', () => {
    expect(permilles([1, 1, 1])).toEqual([334, 333, 333]);
    expect(permilles([2, 1]).reduce((a, b) => a + b)).toBe(1000);
    expect(permilles([0, 0])).toEqual([0, 0]);
    expect(splitEvenly(10, 4)).toEqual([3, 3, 2, 2]);
  });
});
