import type { Card } from '../domain/card/card';
import type { Segment } from '../domain/timeline/segment';
import { activityDay } from '../domain/timeline/day';
import { planReminders } from '../domain/reminders';
import type { Settings } from '../shared/settings';
import type { Reminders } from '../platform/reminders';
import type { AppState, Repositories, Write } from '../data/repos';
import type { Entity } from '../data/repos';
import type { Project } from '../domain/project/project';
import type { Review } from '../domain/review/schedule';
import type { Notice } from '../shared/notices';
import type { HomeSlice } from '../store/homeSlice';
import { projectHome } from './homeProjection';

export interface Snapshot { state: AppState; cards: Card[]; segments: Segment[]; home: HomeSlice; notices: Notice[] }
export interface ContextOptions {
  repos: Repositories; settings: Settings; reminders: Reminders;
  id(): string; now(): string; publish(snapshot: Snapshot): void; log(message: string): Promise<void>;
  random?(): number;
}
export interface Ctx extends ContextOptions { readonly scope: 'root' }
export interface Transaction {
  readonly scope: 'transaction'; readonly repos: Repositories; readonly settings: Settings;
  readonly at: string; readonly id: () => string; readonly now: () => string;
  readonly log: (message: string) => Promise<void>;
  state: AppState; segments: Segment[]; writes: Write[]; notices: Notice[];
  cards: Card[]; projects: Project[]; reviews: Review[];
  random(): number; saveCard(card: Card): void; saveReview(review: Review): void; nextSeq(): number;
}
interface Queue { tail: Promise<unknown>; failure?: unknown; version: number }
const queues = new WeakMap<Ctx, Queue>();

export function createContext(options: ContextOptions): Ctx {
  const ctx: Ctx = { ...options, scope: 'root' };
  queues.set(ctx, { tail: Promise.resolve(), version: 0 });
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
    const [entities, projectEntities, reviewEntities] = await Promise.all([ctx.repos.cards.list(), ctx.repos.projects.list(), ctx.repos.reviews.list()]);
    const originals = new Map<string, Entity<Card>>(entities.map(entity => [entity.value.id, entity]));
    const changed = new Map<string, Card>();
    const originalReviews = new Map(reviewEntities.map(entity => [entity.value.id, entity]));
    const changedReviews = new Map<string, Review>();
    const tx: Transaction = {
      scope: 'transaction', repos: ctx.repos, settings: structuredClone(ctx.settings),
      at: commandAt, id: ctx.id, now: ctx.now, log: ctx.log,
      state, segments, writes: [], notices: [], cards: entities.map(entity => entity.value), projects: projectEntities.map(entity => entity.value), reviews: reviewEntities.map(entity => entity.value),
      random: ctx.random ?? Math.random,
      saveCard(card) { changed.set(card.id, card); this.cards = [...this.cards.filter(item => item.id !== card.id), card]; },
      saveReview(review) { changedReviews.set(review.id, review); this.reviews = [...this.reviews.filter(item => item.id !== review.id), review]; },
      nextSeq() { return ++this.state.max_seq; },
    };
    const value = await work(tx);
    for (const card of changed.values()) tx.writes.push(await ctx.repos.cards.write(card, originals.get(card.id) ?? null));
    for (const review of changedReviews.values()) tx.writes.push(await ctx.repos.reviews.write(review, originalReviews.get(review.id) ?? null));
    tx.writes.push(await ctx.repos.state.write(tx.state));
    try { await ctx.repos.transact(ctx.id(), tx.writes); }
    catch (error) { queue.failure = error; throw error; }
    const cards = (await ctx.repos.cards.list()).map(e => e.value);
    const visibleDays = [...new Set([...days, ...daysFor(tx.state, today)])];
    const visible = await ctx.repos.times.readDays(visibleDays);
    const home = projectHome({ cards, projects: tx.projects, reviews: tx.reviews, state: tx.state, settings: ctx.settings, segments: ctx.repos.times.snapshot(), at: ctx.now(), version: ++queue.version });
    ctx.publish({ state: tx.state, cards, segments: visible, home, notices: tx.notices });
    await ctx.reminders.update(planReminders({ cards, open: tx.segments.find(seg => seg.id === tx.state.open_segment && seg.ended_at === null) ?? null,
      deadlineLeadMinutes: ctx.settings.deadlineLeadMinutes, longActivityMinutes: ctx.settings.longActivityMinutes }));
    return value;
  });
  // The caller observes errors. Only partial writes block subsequent commands.
  queue.tail = result.then(() => undefined, () => undefined);
  return result;
}
