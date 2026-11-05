// 0.3.0-beta.3 E6：回看查询服务的缓存与时钟（审核 G12）。
import { expect, it } from 'vitest';
import { at, fixture, runTx } from './serviceFixture';
import type { Fixture } from './serviceFixture';
import { createContext } from './commit';
import { change } from './settingsService';
import { query, refreshDelay } from './recapService';
import { startFree, stop } from './homeService';

const week = { period: 'week' as const, dim: 'project' as const, includeIdle: false };
const MIN = 60_000;
const value = { description: '写周报', project: '工作', tags: [] };
/** fixture 的「现在」要先拨到操作的时刻，计时系统才认这个时刻。 */
const go = (f: Fixture, minute: number) => { f.clock(at(minute)); return at(minute); };

it('throws a clear error before the first snapshot exists', () => {
  const f = fixture();
  expect(() => query(f.ctx, week)).toThrow('数据还没载入');
});
it('same data and same minute reuse the cached result; a commit or the next minute of a running entry recomputes', async () => {
  const f = fixture();
  await startFree(f.ctx, value, go(f, 0));
  const first = query(f.ctx, week, go(f, 30));
  expect(query(f.ctx, week, new Date(Date.parse(at(30)) + 20_000).toISOString())).toBe(first);
  const later = query(f.ctx, week, go(f, 31));
  expect(later).not.toBe(first);
  expect(later.effectiveMs - first.effectiveMs).toBe(MIN);
  await stop(f.ctx, go(f, 40));
  const after = query(f.ctx, week, go(f, 45));
  expect(after.effectiveMs).toBe(40 * MIN);
  // 没有正在计时的条目时，推进时钟不换缓存
  expect(query(f.ctx, week, go(f, 50))).toBe(after);
});
it('a different Ctx with the same revision does not reuse another context\'s cache', async () => {
  const f = fixture();
  await startFree(f.ctx, value, go(f, 0));
  await stop(f.ctx, go(f, 10));
  const r1 = query(f.ctx, week, go(f, 20));
  const other = createContext({ ...f.ctx, mainEpoch: 9 });
  await runTx(other, async () => {});
  expect(query(other, week, at(20))).not.toBe(r1);
});
it('changing dayBoundaryHour changes dataVersion, so the period is resolved again', async () => {
  const f = fixture();
  await startFree(f.ctx, value, go(f, 0));
  const before = query(f.ctx, week, go(f, 5));
  await change(f.ctx, 'dayBoundaryHour', 6, go(f, 6));
  const after = query(f.ctx, week, go(f, 7));
  expect(after).not.toBe(before);
  expect(Date.parse(after.range.from) - Date.parse(before.range.from)).toBe(2 * 60 * MIN);
});
it('宽松模式：待机不计，开关打开也只多睡眠；切回紧凑模式照旧（ADR 0021 第 13 条，G6 审核 S1）', async () => {
  const f = fixture();
  await startFree(f.ctx, value, go(f, 0));
  await stop(f.ctx, go(f, 10));   // 之后开着的是待机
  const withIdle = { ...week, includeIdle: true };
  const strict = query(f.ctx, withIdle, go(f, 30));
  expect(strict.groups.find(g => g.key === '待机')?.ms).toBe(20 * MIN);
  await change(f.ctx, 'trackingMode', 'loose', go(f, 31));
  const loose = query(f.ctx, withIdle, at(30));
  expect(loose.groups.map(g => g.key)).toEqual(['工作']);
  expect(loose.effectiveMs).toBe(strict.effectiveMs);
});
it('refresh every minute while something runs in the period, otherwise at the next activity-day boundary', async () => {
  const f = fixture();
  await startFree(f.ctx, value, go(f, 0));
  expect(refreshDelay(f.ctx, week, go(f, 5))).toBe(MIN);
  await stop(f.ctx, go(f, 10));
  const delay = refreshDelay(f.ctx, week, at(10));
  expect(delay).toBeGreaterThan(MIN);
  expect(delay).toBeLessThanOrEqual(24 * 60 * MIN);
});
