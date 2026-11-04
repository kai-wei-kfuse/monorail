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
import { appendNotices } from '../store/noticeSlice';
import { canonicalJson, jsonValue, operationId } from '../shared/operation';
import type { CommitWarning, JsonValue, Operation, OperationReceipt, OperationResult } from '../shared/operation';
import type { HistoryIntent } from '../shared/history';

export interface Snapshot {
  state: AppState; cards: Card[]; tasks: Task[]; records: RecordEntry[]; reviews: Review[];
  entries: TimeEntry[]; home: HomeSlice; backpack: BackpackSlice; review: ReviewSlice; settings: Settings; notices: Notice[];
}
export interface ContextOptions {
  repos: Repositories; settings: Settings; reminders: Reminders;
  id(): string; now(): string; publish(snapshot: Snapshot): void; log(message: string): Promise<void>;
  random?(): number;
  settingsPlatform?: SettingsPlatform;
  notices?(): Notice[];
  /** 主窗口会话世代（0.3.0-beta.3 E5）：只有主窗口 bootstrap 从 Rust 取值，其余上下文缺省 0。 */
  mainEpoch?: number;
}
export interface Ctx extends Omit<ContextOptions, 'mainEpoch'> {
  readonly mainEpoch: number;
  readonly scope: 'root'; onSettingsChange(listener: (settings: Settings) => void): () => void;
  onSnapshot(listener: (snapshot: Snapshot) => void): () => void;
  snapshot(): Snapshot | null;
  notices(): Notice[];
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
interface Queue { tail: Promise<unknown>; failure?: unknown; snapshotFailure?: unknown; version: number; paused?: { resumed: Promise<void>; release(): void };
  /** closeMaintenance 之后：不再接纳维护任务，已排队还没开始的取消 */
  maintenanceClosed?: boolean }
const queues = new WeakMap<Ctx, Queue>();
const settingsListeners = new WeakMap<Ctx, Set<(settings: Settings) => void>>();

export function createContext(options: ContextOptions): Ctx {
  const listeners = new Set<(settings: Settings) => void>();
  const snapshots = new Set<(snapshot: Snapshot) => void>();
  let latest: Snapshot | null = null;
  let accumulatedNotices: Notice[] = [];
  const ctx: Ctx = { ...options, mainEpoch: options.mainEpoch ?? 0, scope: 'root',
    onSettingsChange(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    onSnapshot(listener) { snapshots.add(listener); return () => { snapshots.delete(listener); }; },
    snapshot: () => latest,
    notices: () => options.notices ? options.notices() : accumulatedNotices,
    publish(snapshot) {
      accumulatedNotices = appendNotices(accumulatedNotices, snapshot.notices);
      latest = snapshot;
      delete queues.get(ctx)!.snapshotFailure;
      options.publish(snapshot);
      for (const listener of snapshots) listener(snapshot);
    },
  };
  queues.set(ctx, { tail: Promise.resolve(), version: 0 });
  settingsListeners.set(ctx, listeners);
  return ctx;
}

export function assertQueueHealthy(ctx: Ctx): void {
  const queue = queues.get(ctx);
  if (!queue) throw new Error('未初始化的提交上下文');
  if (queue.failure) throw new Error('JOURNAL_BLOCKED：提交已阻塞；请重启以恢复 journal', { cause: queue.failure });
  if (queue.snapshotFailure) throw new Error('SNAPSHOT_UNAVAILABLE：数据已提交但最新快照未能生成，请核对操作回执', { cause: queue.snapshotFailure });
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

interface Execution<T> { data: T; committed_at: string; replayed: boolean; warnings: CommitWarning[] }
/**
 * intent（ADR 0019 第 5 条）：0.3.0-beta.3 E0.5 只定类型并穿到这里，暂为可选、不使用；
 * E8a2 起用于生成操作历史，E8a3 把 run / runOperation 的 intent 改为必填并逐个入口标注。
 */
interface ExecuteOptions { operation?: Operation; signal?: AbortSignal; intent?: HistoryIntent }

const queueOf = (ctx: Ctx): Queue => {
  const queue = queues.get(ctx);
  if (!queue) throw new Error('未初始化的提交上下文');
  return queue;
};
const blocked = (failure: unknown) => new Error('提交已阻塞；请重启以恢复 journal', { cause: failure });

/** UI callers keep their result type and receive an explicit post-commit error. */
export function run<T>(ctx: Ctx | Transaction, work: (tx: Transaction) => Promise<T>, at?: string, intent?: HistoryIntent): Promise<T> {
  return execute(ctx, work, at, { intent }).then(result => {
    if (result.warnings.length) throw new Error(`数据已提交，后续处理失败：${result.warnings.map(w => `${w.phase}: ${w.message}`).join('；')}`);
    return result.data;
  });
}

/** Durable commands use exactly the same queue and transaction as UI actions. */
export function runOperation<T extends JsonValue>(ctx: Ctx, operation: Operation, work: (tx: Transaction) => Promise<T>, at?: string, signal?: AbortSignal, intent?: HistoryIntent): Promise<OperationResult<T>> {
  const id = operationId.parse(operation.id).toLowerCase();
  return execute(ctx, work, at, { operation: { ...operation, id }, signal, intent }).then(result => ({ status: 'committed', operation_id: id, ...result }));
}

/**
 * 串行只读（ADR 0019 第 7 条）：排在同一队列上，看不到写了一半的 journal；不建事务、不写 state.yaml。
 * 队列故障时拒绝。安装更新冻结期间照常可读（读不影响备份）。
 */
export function readSerial<T>(ctx: Ctx, read: () => Promise<T>): Promise<T> {
  const queue = queueOf(ctx);
  const result = queue.tail.then(() => {
    if (queue.failure) throw blocked(queue.failure);
    return read();
  });
  queue.tail = result.then(() => undefined, () => undefined);
  return result;
}

/**
 * 维护任务（ADR 0019 第 7 条，例如清理过期操作历史）：排在同一队列尾部串行执行，与提交、读取互斥；
 * 不建事务、不写 state.yaml，失败不封锁队列。冻结（安装更新）或队列故障时不接纳；
 * 冻结前已接纳的任务照常执行，`pauseCommits().ready` 会等它结束。
 */
export function maintain<T>(ctx: Ctx, task: () => Promise<T>): Promise<T> {
  const queue = queueOf(ctx);
  if (queue.paused) return Promise.reject(new Error('正在安装更新，暂不执行维护任务'));
  if (queue.failure) return Promise.reject(blocked(queue.failure));
  if (queue.maintenanceClosed) return Promise.reject(new Error('CANCELLED：这个上下文已关闭，不再执行维护任务'));
  const result = queue.tail.then(() => {
    if (queue.failure) throw blocked(queue.failure);
    if (queue.maintenanceClosed) throw new Error('CANCELLED：这个上下文已关闭，维护任务没有开始');
    return task();
  });
  queue.tail = result.then(() => undefined, () => undefined);
  return result;
}

/**
 * 切换数据目录重载之前（执行方案 E8a1 第 3 条）：旧 Ctx 不再接纳维护任务，排队还没开始的取消，
 * 正在执行的等它做完；交回的 Promise 在队列排空后完成（之前接纳的提交照常完成）。
 */
export function closeMaintenance(ctx: Ctx): Promise<void> {
  const queue = queueOf(ctx);
  queue.maintenanceClosed = true;
  return queue.tail.then(() => undefined, () => undefined);
}

/** A serialized read cannot observe the receipt of a partially applied journal. */
export function readOperation(ctx: Ctx, id: string, signal?: AbortSignal): Promise<OperationReceipt | null> {
  const queue = queues.get(ctx);
  if (!queue) throw new Error('未初始化的提交上下文');
  if (signal?.aborted) return Promise.reject(new Error('CANCELLED：请求在进入队列前已取消'));
  const normalized = operationId.parse(id).toLowerCase();
  const result = queue.tail.then(() => {
    if (queue.failure) throw new Error('提交已阻塞；请重启以恢复 journal', { cause: queue.failure });
    if (signal?.aborted) throw new Error('CANCELLED：请求在执行前已取消');
    return ctx.repos.receipts.get(normalized);
  });
  queue.tail = result.then(() => undefined, () => undefined);
  return result;
}

async function postCommit(phase: CommitWarning['phase'], work: () => void | Promise<void>, warnings: CommitWarning[]) {
  try { await work(); }
  catch (error) { warnings.push({ phase, message: error instanceof Error ? error.message : String(error) }); }
}

/** Root contexts enqueue independent actions. Transaction scopes may never enqueue. */
function execute<T>(ctx: Ctx | Transaction, work: (tx: Transaction) => Promise<T>, at: string | undefined, options: ExecuteOptions): Promise<Execution<T>> {
  if (ctx.scope === 'transaction') throw new Error('事务重入：请调用 InTx 函数');
  const { operation, signal } = options;
  const queue = queues.get(ctx);
  if (!queue) throw new Error('未初始化的提交上下文');
  if (queue.paused) return Promise.reject(new Error('正在安装更新，暂时不能提交新操作'));
  if (signal?.aborted) return Promise.reject(new Error('CANCELLED：请求在进入队列前已取消'));
  const commandAt = at ?? ctx.now();
  const result = queue.tail.then(async () => {
    if (queue.failure) throw new Error('提交已阻塞；请重启以恢复 journal', { cause: queue.failure });
    if (signal?.aborted) throw new Error('CANCELLED：请求在进入事务执行前已取消');
    const input = operation ? canonicalJson(jsonValue.parse(operation.input)) : undefined;
    if (operation) {
      const existing = await ctx.repos.receipts.get(operation.id);
      if (existing) {
        if (existing.command !== operation.command || existing.input !== input) throw new Error('OPERATION_CONFLICT：操作 ID 已用于不同请求');
        return { data: existing.data as T, committed_at: existing.committed_at, replayed: true, warnings: [] };
      }
    }
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
    const committedAt = ctx.now();
    if (operation) tx.writes.push(await ctx.repos.receipts.write({
      version: 1, operation_id: operation.id, command: operation.command, input: input!,
      data: jsonValue.parse(value), committed_at: committedAt,
    }));
    try { await ctx.repos.transact(ctx.id(), tx.writes); }
    catch (error) { queue.failure = error; throw error; }
    // Older snapshots remain readable during a transaction, but must never masquerade as its committed result.
    queue.snapshotFailure = new Error('Committed projection has not been published');
    const warnings: CommitWarning[] = [];
    if (settingsWrite) {
      ctx.settings = settings;
      for (const listener of settingsListeners.get(ctx)!) await postCommit('settings', () => listener(settings), warnings);
    }
    await postCommit('projection', () => {
      const entriesSnapshot = ctx.repos.times.snapshot();
      const home = projectHome({ cards: tx.cards, tasks: tx.tasks, reviews: tx.reviews, state: tx.state, settings: ctx.settings, entries: entriesSnapshot, at: ctx.now(), version: ++queue.version });
      const backpack = projectBackpack(tx.cards, tx.tasks, tx.records, entriesSnapshot, ctx.settings, ctx.now());
      const review = projectReview({ cards: tx.cards, tasks: tx.tasks, records: tx.records, reviews: tx.reviews, entries: entriesSnapshot, state: tx.state, settings: ctx.settings, at: ctx.now() });
      ctx.publish({
        state: structuredClone(tx.state),
        cards: structuredClone(tx.cards),
        tasks: structuredClone(tx.tasks),
        records: structuredClone(tx.records),
        reviews: structuredClone(tx.reviews),
        entries: entriesSnapshot,
        home,
        backpack,
        review,
        settings: structuredClone(ctx.settings),
        notices: structuredClone(tx.notices),
      });
    }, warnings);
    await postCommit('reminders', () => ctx.reminders.update(planReminders({ cards: tx.cards, open: tx.entries.find(seg => seg.id === tx.state.open_entry && seg.ended_at === null) ?? null,
      deadlineLeadMinutes: ctx.settings.deadlineLeadMinutes, longActivityMinutes: ctx.settings.longActivityMinutes })), warnings);
    if (warnings.length) await postCommit('logging', () => ctx.log(`post-commit-warning:${JSON.stringify(warnings)}`), warnings);
    return { data: value, committed_at: committedAt, replayed: false, warnings };
  });
  // The caller observes errors. Only partial writes block subsequent commands.
  queue.tail = result.then(() => undefined, () => undefined);
  return result;
}
