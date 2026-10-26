import type { Card } from '../domain/card/card';
import type { Segment } from '../domain/timeline/segment';
import { activityDay } from '../domain/timeline/day';
import type { Settings } from '../shared/settings';
import type { Reminders } from '../platform/reminders';
import type { AppState, Repositories, Write } from '../data/repos';

export interface Snapshot { state: AppState; cards: Card[]; segments: Segment[] }
export interface ContextOptions {
  repos: Repositories; settings: Settings; reminders: Reminders;
  id(): string; now(): string; publish(snapshot: Snapshot): void; log(message: string): Promise<void>;
}
export interface Ctx extends ContextOptions { readonly scope: 'root' }
export interface Transaction {
  readonly scope: 'transaction'; readonly repos: Repositories; readonly settings: Settings;
  readonly at: string; readonly id: () => string; readonly now: () => string;
  readonly log: (message: string) => Promise<void>;
  state: AppState; segments: Segment[]; writes: Write[]; nextSeq(): number;
}
interface Queue { tail: Promise<unknown>; failure?: unknown }
const queues = new WeakMap<Ctx, Queue>();

export function createContext(options: ContextOptions): Ctx {
  const ctx: Ctx = { ...options, scope: 'root' };
  queues.set(ctx, { tail: Promise.resolve() });
  return ctx;
}

function daysFor(state: AppState, today: string): string[] {
  if (state.open_segment && !state.open_segment_day) throw new Error('当前计时段缺少日期，请先执行启动校验');
  return [...new Set([today, ...(state.open_segment_day ? [state.open_segment_day] : [])])];
}

/** Root contexts enqueue independent actions. Transaction scopes may never enqueue. */
export function run<T>(ctx: Ctx | Transaction, work: (tx: Transaction) => Promise<T>, at?: string): Promise<T> {
  if (ctx.scope === 'transaction') throw new Error('事务重入：请调用 InTx 函数');
  const queue = queues.get(ctx);
  if (!queue) throw new Error('未初始化的提交上下文');
  const commandAt = at ?? ctx.now();
  const result = queue.tail.then(async () => {
    if (queue.failure) throw new Error('提交已阻塞；请重启以恢复 journal', { cause: queue.failure });
    const state = await ctx.repos.state.read();
    const today = activityDay(ctx.now(), ctx.settings.dayBoundaryHour);
    const days = daysFor(state, today);
    const segments = await ctx.repos.times.readDays(days);
    const tx: Transaction = {
      scope: 'transaction', repos: ctx.repos, settings: structuredClone(ctx.settings),
      at: commandAt, id: ctx.id, now: ctx.now, log: ctx.log,
      state, segments, writes: [], nextSeq() { return ++this.state.max_seq; },
    };
    const value = await work(tx);
    tx.writes.push(await ctx.repos.state.write(tx.state));
    try { await ctx.repos.transact(ctx.id(), tx.writes); }
    catch (error) { queue.failure = error; throw error; }
    const cards = (await ctx.repos.cards.list()).map(e => e.value);
    const visibleDays = [...new Set([...days, ...daysFor(tx.state, today)])];
    ctx.publish({ state: tx.state, cards, segments: await ctx.repos.times.readDays(visibleDays) });
    await ctx.reminders.update(cards.filter(c => c.due_at && c.status !== '已完成').map(c => ({
      id: `deadline:${c.id}:${c.due_at}`, at: Date.parse(c.due_at!) - ctx.settings.deadlineLeadMinutes * 60_000,
      title: '待办期限提醒', body: c.content,
    })));
    return value;
  });
  // The caller observes errors. Only partial writes block subsequent commands.
  queue.tail = result.then(() => undefined, () => undefined);
  return result;
}
