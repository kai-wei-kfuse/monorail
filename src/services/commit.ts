import type { Card } from '../domain/card/card';
import type { TimeEntry } from '../domain/timeline/entry';
import { startSystemInTx } from './tracking/api';
import { activityDay } from '../domain/timeline/day';
import { planReminders } from '../domain/reminders';
import type { Settings } from '../shared/settings';
import type { Reminders } from '../platform/reminders';
import type { AppState, Repositories, Write } from '../data/repos';
import type { RecordEntry } from '../domain/record/record';
import type { Task } from '../domain/task/task';
import type { Review } from '../domain/review/schedule';
import type { Notice } from '../shared/notices';
import type { HomeSlice } from '../store/homeSlice';
import { projectHome } from './homeProjection';
import { projectBackpack } from './backpackProjection';
import type { BackpackSlice } from '../store/backpackSlice';
import { entityChanges } from './entityChanges';
import type { SettingsPlatform } from '../platform/settings';
import type { ReviewSlice } from '../store/reviewSlice';
import { projectReview } from './reviewProjection';

export interface Snapshot { state: AppState; cards: Card[]; entries: TimeEntry[]; home: HomeSlice; backpack: BackpackSlice; review: ReviewSlice; settings: Settings; notices: Notice[] }
export interface ContextOptions {
  repos: Repositories; settings: Settings; reminders: Reminders;
  id(): string; now(): string; publish(snapshot: Snapshot): void; log(message: string): Promise<void>;
  random?(): number;
  settingsPlatform?: SettingsPlatform;
}
export interface Ctx extends ContextOptions {
  readonly scope: 'root'; onSettingsChange(listener: (settings: Settings) => void): () => void;
  onSnapshot(listener: (snapshot: Snapshot) => void): () => void;
  snapshot(): Snapshot | null;
}
export interface Transaction {
  readonly revision: number;
  readonly scope: 'transaction'; readonly repos: Repositories; readonly settings: Settings;
  readonly at: string; readonly id: () => string; readonly now: () => string;
  readonly log: (message: string) => Promise<void>;
  state: AppState; entries: TimeEntry[]; writes: Write[]; notices: Notice[];
  readonly cards: Card[]; readonly tasks: Task[]; readonly reviews: Review[]; readonly records: RecordEntry[];
  random(): number; saveCard(card: Card): void; saveReview(review: Review): void;
  saveTask(task: Task): void; saveRecord(record: RecordEntry): void; removeRecord(id: string): void;
  saveSettings(settings: Settings): Promise<void>;
}
interface Queue { tail: Promise<unknown>; failure?: unknown; version: number; paused?: { resumed: Promise<void>; release(): void } }
const queues = new WeakMap<Ctx, Queue>();
const settingsListeners = new WeakMap<Ctx, Set<(settings: Settings) => void>>();

export function createContext(options: ContextOptions): Ctx {
  const listeners = new Set<(settings: Settings) => void>();
  const snapshots = new Set<(snapshot: Snapshot) => void>();
  let latest: Snapshot | null = null;
  const ctx: Ctx = { ...options, scope: 'root',
    onSettingsChange(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    onSnapshot(listener) { snapshots.add(listener); return () => { snapshots.delete(listener); }; },
    snapshot: () => latest,
    publish(snapshot) { latest = snapshot; options.publish(snapshot); for (const listener of snapshots) listener(snapshot); },
  };
  queues.set(ctx, { tail: Promise.resolve(), version: 0 });
  settingsListeners.set(ctx, listeners);
  return ctx;
}

/** Atomically stop admission, then drain every command accepted before the update barrier. */
export function pauseCommits(ctx: Ctx): { ready: Promise<void>; resume(): void } {
  const queue = queues.get(ctx);
  if (!queue) throw new Error('未初始化的提交上下文');
  if (queue.paused) throw new Error('提交队列已经在安装更新');
  let release!: () => void;
  const resumed = new Promise<void>(resolve => { release = resolve; });
  queue.paused = { resumed, release };
  return {
    ready: queue.tail.then(() => { if (queue.failure) throw new Error('提交已阻塞；请重启以恢复 journal', { cause: queue.failure }); }),
    resume() { delete queue.paused; release(); },
  };
}

/** Background producers wait for a cancelled install instead of losing a day/power event. */
export async function whenCommitsOpen<T>(ctx: Ctx, work: () => Promise<T>): Promise<T> {
  const queue = queues.get(ctx);
  if (!queue) throw new Error('未初始化的提交上下文');
  while (queue.paused) await queue.paused.resumed;
  return work();
}

/** Root contexts enqueue independent actions. Transaction scopes may never enqueue. */
export function run<T>(ctx: Ctx | Transaction, work: (tx: Transaction) => Promise<T>, at?: string): Promise<T> {
  if (ctx.scope === 'transaction') throw new Error('事务重入：请调用 InTx 函数');
  const queue = queues.get(ctx);
  if (!queue) throw new Error('未初始化的提交上下文');
  if (queue.paused) return Promise.reject(new Error('正在安装更新，暂时不能提交新操作'));
  const commandAt = at ?? ctx.now();
  const result = queue.tail.then(async () => {
    if (queue.failure) throw new Error('提交已阻塞；请重启以恢复 journal', { cause: queue.failure });
    const state = await ctx.repos.state.read();
    const entries = ctx.repos.times.snapshot();
    const [entities, taskEntities, reviewEntities, recordEntities] = await Promise.all([ctx.repos.cards.list(), ctx.repos.tasks.list(), ctx.repos.reviews.list(), ctx.repos.records.list()]);
    const cards = entityChanges(ctx.repos.cards, entities), tasks = entityChanges(ctx.repos.tasks, taskEntities);
    const reviews = entityChanges(ctx.repos.reviews, reviewEntities);
    const records = entityChanges(ctx.repos.records, recordEntities, (record, original) =>
      !original || record.text !== original.value.text ? record.text : undefined);
    let settings = structuredClone(ctx.settings);
    let settingsWrite: Write | undefined;
    const tx: Transaction = {
      scope: 'transaction', revision: queue.version, repos: ctx.repos, get settings() { return settings; },
      at: commandAt, id: ctx.id, now: ctx.now, log: ctx.log,
      state, entries, writes: [], notices: [],
      get cards() { return cards.values; }, get tasks() { return tasks.values; },
      get reviews() { return reviews.values; }, get records() { return records.values; },
      random: ctx.random ?? Math.random,
      saveCard: card => {
        const previous = cards.values.find(item => item.id === card.id);
        cards.save(previous ? { ...card, progress_noted_at: previous.progress_note !== card.progress_note
          ? commandAt : previous.progress_noted_at } : card);
      }, saveReview: review => reviews.save(review),
      saveTask: task => tasks.save(task), saveRecord: record => records.save(record), removeRecord: id => records.remove(id),
      async saveSettings(value) { settingsWrite = await ctx.repos.settings.write(value); settings = structuredClone(value); },
    };
    if (!tx.state.open_entry) startSystemInTx(tx, '待机');
    const value = await work(tx);
    const open = tx.entries.filter(entry => entry.ended_at === null);
    if (open.length !== 1 || open[0].id !== tx.state.open_entry) throw new Error('当前计时条目与运行指针不一致');
    tx.state.open_entry_day = activityDay(open[0].started_at, tx.settings.dayBoundaryHour);
    tx.writes.push(...await ctx.repos.times.writes(tx.entries, ctx.now(), tx.settings.dayBoundaryHour));
    if (settingsWrite) tx.writes.push(settingsWrite);
    tx.writes.push(...await cards.writes(), ...await tasks.writes(), ...await reviews.writes(), ...await records.writes());
    tx.writes.push(await ctx.repos.state.write(tx.state));
    try { await ctx.repos.transact(ctx.id(), tx.writes); }
    catch (error) { queue.failure = error; throw error; }
    if (settingsWrite) {
      ctx.settings = settings;
      for (const listener of settingsListeners.get(ctx)!) listener(settings);
    }
    const home = projectHome({ cards: tx.cards, tasks: tx.tasks, reviews: tx.reviews, state: tx.state, settings: ctx.settings, entries: ctx.repos.times.snapshot(), at: ctx.now(), version: ++queue.version });
    const backpack = projectBackpack(tx.cards, tx.tasks, tx.records, ctx.repos.times.snapshot(), ctx.settings, ctx.now());
    const review = projectReview({ cards: tx.cards, tasks: tx.tasks, records: tx.records, reviews: tx.reviews, entries: ctx.repos.times.snapshot(), state: tx.state, settings: ctx.settings, at: ctx.now() });
    ctx.publish({ state: tx.state, cards: tx.cards, entries: ctx.repos.times.snapshot(), home, backpack, review, settings: ctx.settings, notices: tx.notices });
    await ctx.reminders.update(planReminders({ cards: tx.cards, open: tx.entries.find(seg => seg.id === tx.state.open_entry && seg.ended_at === null) ?? null,
      deadlineLeadMinutes: ctx.settings.deadlineLeadMinutes, longActivityMinutes: ctx.settings.longActivityMinutes }));
    return value;
  });
  // The caller observes errors. Only partial writes block subsequent commands.
  queue.tail = result.then(() => undefined, () => undefined);
  return result;
}
