// 0.3.0-beta.3 E6 第 7 条：一年约一万条条目时一次聚合的耗时（目标 < 50 ms）。打印实测值，供证据记录；
// 断言只设一个宽松上限防止明显退化，不把测试机的速度写成通过标准。
import { expect, it } from 'vitest';
import type { TimeEntry } from '../timeline/entry';
import { computeRecap } from './recap';
import { prepare } from '../timeline/recap';
import type { RecapDimension, RecapPeriod } from '../../shared/recap';

function year(): TimeEntry[] {
  let seed = 20261108; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out: TimeEntry[] = [];
  const projects = ['工作', '学习', '生活', '运动', '求职', '娱乐'], tags = ['408', 'python', '面试', '健身', '复盘'];
  for (let day = 0; day < 365; day++) {
    let t = new Date(2025, 10, 9 + day, 8).getTime();
    for (let i = 0; i < 28; i++) {
      const len = (10 + Math.floor(rnd() * 50)) * 60_000, overlap = rnd() < .1 ? -Math.floor(len / 3) : 0;
      const start = t + overlap, end = start + len;
      out.push({ id: `y${day}-${i}`, started_at: new Date(start).toISOString(), ended_at: new Date(end).toISOString(),
        description: `活动${Math.floor(rnd() * 120)}`, project: rnd() < .08 ? '待机' : projects[Math.floor(rnd() * projects.length)],
        tags: rnd() < .5 ? [tags[Math.floor(rnd() * tags.length)]] : [], card_id: null, kind: rnd() < .05 ? '插入' : '普通', source: '计时', updated_at: new Date(end).toISOString() });
      t = Math.max(t, end);
    }
  }
  return out;
}

it('one year of entries aggregates within a generous bound; prints the measured times', () => {
  const entries = year(), asOf = new Date(2026, 10, 10, 12).toISOString(), times: Record<string, number> = {};
  const cases: [RecapPeriod, RecapDimension][] = [['year', 'project'], ['year', 'activity'], ['quarter', 'tag'], ['week', 'source']];
  // 服务层按 dataVersion 缓存 prepare 的结果，所以这里也先做一次 prepare，只测查询本身；每种取 5 次的中位数
  const prepared = prepare(entries);
  times.prepare = Math.round((() => { const t0 = performance.now(); prepare(entries); return performance.now() - t0; })());
  for (const [period, dim] of cases) {
    const run = () => computeRecap({ entries, cards: [], tasks: [], lastReviewAt: null, firstUsedDay: '2025-11-01', projectColors: {}, boundaryHour: 4, asOf, prepared, query: { period, dim, includeIdle: false } });
    run();
    const samples = Array.from({ length: 5 }, () => { const t0 = performance.now(); const r = run(); expect(r.groups.reduce((a, g) => a + g.ms, 0)).toBe(r.totalMs); return performance.now() - t0; }).sort((a, b) => a - b);
    times[`${period}/${dim}`] = Math.round(samples[2]);
  }
  console.log(`RECAP_PERF entries=${entries.length} ${JSON.stringify(times)}`);
  for (const ms of Object.values(times)) expect(ms).toBeLessThan(3000);
});
