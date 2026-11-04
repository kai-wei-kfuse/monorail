// 回看查询（0.3.0-beta.3 D7，执行方案 E6 第 3、6 条）：随时可看，不跟着每次提交重算。
// 从内存里的计时索引读（启动时已全部载入），不做 structuredClone；聚合函数不改输入。
import type { Ctx } from './commit';
import { recapStart } from './reviewProjection';
import { computeRecap } from '../domain/review/recap';
import { prepare, resolvePeriod } from '../domain/timeline/recap';
import type { Prepared } from '../domain/timeline/recap';
import type { RecapQuery, RecapResult } from '../shared/recap';
import { MINUTE } from '../shared/time';

const caches = new WeakMap<Ctx, Map<string, RecapResult>>();
/** 解析好的计时索引：同一个 Ctx、同一个 dataVersion 下各种查询共用（不依赖「现在」）。 */
const indexes = new WeakMap<Ctx, { version: number; prepared: Prepared }>();
const LIMIT = 24;

/**
 * 查一次回看。asOf 是「现在」：正在计时的条目以它为终点，「今天」「本周」也按它算。
 * 缓存键 = Ctx 会话世代 + dataVersion + 查询参数 + 解析出的周期范围 + （周期包含现在且有正在计时的条目时）asOf 取整到分钟。
 * 不同 Ctx（换数据目录、重载）各有各的缓存，相同修订号不会串用。
 */
export function query(ctx: Ctx, q: RecapQuery, asOf: string = ctx.now()): RecapResult {
  const snapshot = ctx.snapshot();
  if (!snapshot) throw new Error('数据还没载入，稍后再看回看');
  const { cards, tasks, reviews, state, settings, home } = snapshot;
  const boundaryHour = settings.dayBoundaryHour;
  const lastReviewAt = state.first_used_day ? recapStart(reviews, state.first_used_day, boundaryHour, asOf) : null;
  const range = resolvePeriod(q.period, { asOf, boundaryHour, lastReviewAt, from: q.from, to: q.to });
  const entries = ctx.repos.times.snapshot();
  const live = entries.some(e => e.ended_at === null && e.project !== '待机') && Date.parse(range.to) > Date.parse(asOf);
  const key = JSON.stringify([ctx.mainEpoch, home.dataVersion, q.period, q.from ?? null, q.to ?? null, q.dim, q.includeIdle, q.bucket ?? null,
    range.from, range.to, live ? Math.floor(Date.parse(asOf) / MINUTE) : null]);
  let cache = caches.get(ctx);
  if (!cache) caches.set(ctx, cache = new Map());
  const hit = cache.get(key);
  if (hit) return hit;
  const projectColors = Object.fromEntries(settings.lists.projects.map(p => [p.name, p.color]));
  let index = indexes.get(ctx);
  if (!index || index.version !== home.dataVersion) indexes.set(ctx, index = { version: home.dataVersion, prepared: prepare(entries) });
  const result = computeRecap({ entries, cards, tasks, lastReviewAt, firstUsedDay: state.first_used_day, projectColors, boundaryHour, asOf, query: q, prepared: index.prepared });
  cache.set(key, result);
  if (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
  return result;
}

/**
 * 页面开着时多久要重查一次：周期包含现在且有正在计时的条目时每 60 秒；否则到下一个活动日界
 * （跨日后「今天」「本周」「本月」要重新解析）。纯历史区间也要在日界重查一次，因为「今天」变了。
 */
export function refreshDelay(ctx: Ctx, q: RecapQuery, asOf: string = ctx.now()): number {
  const snapshot = ctx.snapshot();
  if (!snapshot) return MINUTE;
  const boundaryHour = snapshot.settings.dayBoundaryHour;
  const range = resolvePeriod(q.period, { asOf, boundaryHour, from: q.from, to: q.to });
  const now = Date.parse(asOf);
  const today = resolvePeriod('custom', { asOf, boundaryHour });
  const untilNextDay = Math.max(1000, Date.parse(today.to) - now);
  const live = ctx.repos.times.snapshot().some(e => e.ended_at === null && e.project !== '待机') && Date.parse(range.to) > now;
  return live ? Math.min(MINUTE, untilNextDay) : untilNextDay;
}
