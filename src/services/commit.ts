import type { Card } from '../domain/card/card';
import { askChoices } from '../shared/notices';
import type { TimeEntry } from '../domain/timeline/entry';
import { startSystemInTx } from './tracking/api';
import { activityDay, activityDayStartOf } from '../domain/timeline/day';
import { planReminders } from '../domain/reminders';
import type { Settings } from '../shared/settings';
import type { Reminders } from '../platform/reminders';
import type { AppState, PlanFile, Repositories, Write } from '../data/repos';
import type { DayPlan } from '../domain/plan/plan';
import type { RecordEntry } from '../domain/record/record';
import type { Task } from '../domain/task/task';
import type { Review } from '../domain/review/schedule';
import type { Notice } from '../shared/notices';
import type { HomeSlice } from '../store/homeSlice';
import { projectHome } from './homeProjection';
import { projectBackpack } from './backpackProjection';
import { projectPlan } from './planProjection';
import type { PlanSlice } from '../store/planSlice';
import { minutesOnDay, shiftDay } from '../domain/plan/plan';
import { activeRefInTx } from './tracking/api';
import type { BackpackSlice } from '../store/backpackSlice';
import { entityChanges } from './entityChanges';
import type { SettingsPlatform } from '../platform/settings';
import type { ReviewSlice } from '../store/reviewSlice';
import { projectReview } from './reviewProjection';
import { appendNotices } from '../store/noticeSlice';
import { canonicalJson, jsonValue, operationId } from '../shared/operation';
import type { CommitWarning, JsonValue, Operation, OperationReceipt, OperationResult } from '../shared/operation';
import type { HistoryIntent } from '../shared/history';
import { absorbQuickbarInTx, captureHistory } from './historyCapture';
import { materializeTodoRecordInTx } from './recordMaterialize';
import type { MergePointer, PendingHistory } from './historyCapture';

export interface Snapshot {
  state: AppState; cards: Card[]; tasks: Task[]; records: RecordEntry[]; reviews: Review[];
  entries: TimeEntry[]; home: HomeSlice; backpack: BackpackSlice; review: ReviewSlice; settings: Settings; notices: Notice[];
  /** 今日任务板（今天、明天两块；ADR 0021 第 1 条） */
  plan: PlanSlice;
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
  /** 今日任务板（ADR 0021 第 1 条）：今天那份在建事务时预读（同步的 InTx 可用）；「今天」按 tx.at 算。 */
  readonly todayPlan: DayPlan;
  /** 别的日子懒读（同一事务内缓存）；只有 async 的 InTx 能调用。 */
  plan(day: string): Promise<DayPlan>;
  savePlan(plan: DayPlan): void;
}
interface Queue { tail: Promise<unknown>; failure?: unknown; snapshotFailure?: unknown; version: number; paused?: { resumed: Promise<void>; release(): void };
  /** closeMaintenance 之后：不再接纳维护任务，已排队还没开始的取消 */
  maintenanceClosed?: boolean }
const queues = new WeakMap<Ctx, Queue>();
/** 每个 Ctx 上一条设置历史（设置合并用；ADR 0019 第 3 条）。清理跳过它所指的文件。 */
const mergePointers = new WeakMap<Ctx, MergePointer>();
export const historyMergePath = (ctx: Ctx): string | null => mergePointers.get(ctx)?.path ?? null;
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
 * intent（ADR 0019 第 5 条）：run / runOperation 必填（E8a3）；execute 内部仍按可选处理，
 * 以便 runTx 之类的测试夹具绕开历史。
 */
interface ExecuteOptions { operation?: Operation; signal?: AbortSignal; intent?: HistoryIntent }

const queueOf = (ctx: Ctx): Queue => {
  const queue = queues.get(ctx);
  if (!queue) throw new Error('未初始化的提交上下文');
  return queue;
};
const blocked = (failure: unknown) => new Error('提交已阻塞；请重启以恢复 journal', { cause: failure });

/** UI callers keep their result type and receive an explicit post-commit error. */
export function run<T>(ctx: Ctx | Transaction, work: (tx: Transaction) => Promise<T>, at: string | undefined, intent: HistoryIntent): Promise<T> {
  return execute(ctx, work, at, { intent }).then(result => {
    if (result.warnings.length) throw new Error(`数据已提交，后续处理失败：${result.warnings.map(w => `${w.phase}: ${w.message}`).join('；')}`);
    return result.data;
  });
}

/** Durable commands use exactly the same queue and transaction as UI actions. */
export function runOperation<T extends JsonValue>(ctx: Ctx, operation: Operation, work: (tx: Transaction) => Promise<T>, at: string | undefined, signal: AbortSignal | undefined, intent: HistoryIntent): Promise<OperationResult<T>> {
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
    // 今日任务板：载入时的原文留着做 journal 的 before；改过的才写（ADR 0021 第 1 条）
    const todayKey = activityDay(commandAt, settings.dayBoundaryHour);
    const plans = new Map<string, { file: PlanFile; value: DayPlan; dirty: boolean }>();
    const loadPlan = async (day: string) => {
      let slot = plans.get(day);
      if (!slot) { const file = await ctx.repos.plans.read(day); slot = { file, value: structuredClone(file.value), dirty: false }; plans.set(day, slot); }
      return slot;
    };
    await loadPlan(todayKey);
    await loadPlan(shiftDay(todayKey, 1));   // 投影要显示明天那块；不改就不写
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
      get todayPlan() { return plans.get(todayKey)!.value; },
      async plan(day) { return (await loadPlan(day)).value; },
      savePlan(plan) {
        const slot = plans.get(plan.day);
        if (!slot) throw new Error(`今日任务板 ${plan.day} 没有在这个事务里读过`);
        slot.value = structuredClone(plan); slot.dirty = true;
      },
    };
    // 先补记、再消费（ADR 0019 第 5 条）：快速记录条存的、还没写过历史的记录，在执行动作之前先吸收
    const absorbed = absorbQuickbarInTx(tx, { cards, tasks, reviews, records }, ctx.repos, ctx.id, record => {
      let order = Math.max(0, ...tx.cards.map(card => card.order));
      materializeTodoRecordInTx(tx, record, () => ++order);
    });
    // 改动前的数据（ADR 0019 第 4、5 条）：state、settings 先拷一份；实体与条目的改前值由 entityChanges / changedDays 从载入时的原文取
    // （吸收过的对象从吸收之后算）。没有进行中条目时自动开始待机放在这之后，所以它在用户动作里作为连带出现。
    const beforeState = structuredClone(tx.state), beforeSettings = structuredClone(ctx.settings);
    if (!tx.state.open_entry) startSystemInTx(tx, '待机');
    const idleBefore = tx.entries.find(e => e.id === tx.state.open_entry && e.ended_at === null && e.project === '待机')?.id ?? null;
    const value = await work(tx);
    // 空闲追问（紧凑模式）：事务开始时开着待机，提交后开着的不是待机，那段待机在这次结束时的实际长度超过阈值就问一句
    if (idleBefore && tx.settings.trackingMode === 'strict') {
      const idle = tx.entries.find(e => e.id === idleBefore), now = tx.entries.find(e => e.id === tx.state.open_entry && e.ended_at === null);
      const minutes = idle?.ended_at ? (Date.parse(idle.ended_at) - Date.parse(idle.started_at)) / 60_000 : 0;
      if (idle && now && now.project !== '待机' && minutes > tx.settings.idleAskMinutes)
        tx.notices.push({ id: tx.id(), kind: 'idleAsk', data: { entryId: idle.id, from: idle.started_at, to: idle.ended_at!, minutes: Math.round(minutes),
          ...askChoices(tx.settings) } });
    }
    const open = tx.entries.filter(entry => entry.ended_at === null);
    if (open.length !== 1 || open[0].id !== tx.state.open_entry) throw new Error('当前计时条目与运行指针不一致');
    tx.state.open_entry_day = activityDay(open[0].started_at, tx.settings.dayBoundaryHour);
    tx.writes.push(...await ctx.repos.times.writes(tx.entries, ctx.now(), tx.settings.dayBoundaryHour));
    if (settingsWrite) tx.writes.push(settingsWrite);
    tx.writes.push(...await cards.writes(), ...await tasks.writes(), ...await reviews.writes(), ...await records.writes());
    for (const slot of plans.values()) if (slot.dirty) tx.writes.push(ctx.repos.plans.write(slot.value, slot.file));
    tx.writes.push(await ctx.repos.state.write(tx.state));
    const committedAt = ctx.now();
    if (operation) tx.writes.push(await ctx.repos.receipts.write({
      version: 1, operation_id: operation.id, command: operation.command, input: input!,
      data: jsonValue.parse(value), committed_at: committedAt,
    }));
    // 操作历史：有实质改动就把历史 write 追加进同一份 journal（receipt 之后、transact 之前）；吸收的快速记录条历史也在这里
    tx.writes.push(...absorbed.map(w => w.write));
    let history: PendingHistory | null = null;
    if (options.intent) {
      history = captureHistory(ctx.repos, {
        intent: options.intent, value, at: commandAt, boundaryHour: tx.settings.dayBoundaryHour, id: ctx.id,
        ...(operation ? { operation: { id: operation.id, command: operation.command, input: input! } } : {}),
        before: { state: beforeState as unknown as Record<string, unknown>, settings: beforeSettings },
        after: { state: tx.state as unknown as Record<string, unknown>, settings: tx.settings, cards: tx.cards, tasks: tx.tasks, entries: tx.entries },
        changed: { cards: cards.changed(), tasks: tasks.changed(), reviews: reviews.changed(), records: records.changed(),
          days: ctx.repos.times.changedDays(tx.entries, tx.settings.dayBoundaryHour),
          plans: [...plans.values()].filter(slot => slot.dirty).map(slot => ({ before: slot.file.value, after: slot.value })) },
      }, mergePointers.get(ctx) ?? null, Date.parse(committedAt));
      if (history) tx.writes.push(history.write.write);
    }
    try { await ctx.repos.transact(ctx.id(), tx.writes); }
    catch (error) { queue.failure = error; mergePointers.delete(ctx); throw error; }
    // 合并指针只在提交成功后更新；这次不是设置改动就清空，下一次设置改动另起一条
    if (options.intent) { if (history?.pointer) mergePointers.set(ctx, history.pointer); else if (history) mergePointers.delete(ctx); }
    // Older snapshots remain readable during a transaction, but must never masquerade as its committed result.
    queue.snapshotFailure = new Error('Committed projection has not been published');
    const warnings: CommitWarning[] = [];
    if (settingsWrite) {
      ctx.settings = settings;
      for (const listener of settingsListeners.get(ctx)!) await postCommit('settings', () => listener(settings), warnings);
    }
    await postCommit('projection', () => {
      const entriesSnapshot = ctx.repos.times.snapshot();
      const home = projectHome({ cards: tx.cards, tasks: tx.tasks, reviews: tx.reviews, state: tx.state, settings: ctx.settings, entries: entriesSnapshot, at: ctx.now(), version: ++queue.version,
        planToday: plans.get(todayKey)!.value });
      const backpack = projectBackpack(tx.cards, tx.tasks, tx.records, entriesSnapshot, ctx.settings, ctx.now());
      const review = projectReview({ cards: tx.cards, tasks: tx.tasks, records: tx.records, reviews: tx.reviews, entries: entriesSnapshot, state: tx.state, settings: ctx.settings, at: ctx.now() });
      const plan = projectPlan({ today: plans.get(todayKey)!.value, tomorrow: plans.get(shiftDay(todayKey, 1))!.value, cards: tx.cards, tasks: tx.tasks,
        entries: entriesSnapshot, runningCard: activeRefInTx(tx), boundaryHour: ctx.settings.dayBoundaryHour, at: ctx.now() });
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
        plan,
        settings: structuredClone(ctx.settings),
        notices: structuredClone(tx.notices),
      });
    }, warnings);
    const openNow = tx.entries.find(seg => seg.id === tx.state.open_entry && seg.ended_at === null) ?? null;
    const goalItem = openNow?.card_id ? plans.get(todayKey)!.value.items.find(item => item.card_id === openNow.card_id && item.today_minutes !== null) : undefined;
    const todayGoal = openNow && goalItem ? { cardId: goalItem.card_id, day: todayKey, todayMinutes: goalItem.today_minutes!,
      minutesToday: minutesOnDay(tx.entries.filter(e => e.id !== openNow.id), goalItem.card_id, todayKey, ctx.settings.dayBoundaryHour, ctx.now()),
      dayStart: activityDayStartOf(todayKey, ctx.settings.dayBoundaryHour) } : null;
    await postCommit('reminders', () => ctx.reminders.update(planReminders({ cards: tx.cards, open: openNow, todayGoal, loose: ctx.settings.trackingMode === 'loose',
      deadlineLeadMinutes: ctx.settings.deadlineLeadMinutes, longActivityMinutes: ctx.settings.longActivityMinutes })), warnings);
    if (warnings.length) await postCommit('logging', () => ctx.log(`post-commit-warning:${JSON.stringify(warnings)}`), warnings);
    return { data: value, committed_at: committedAt, replayed: false, warnings };
  });
  // The caller observes errors. Only partial writes block subsequent commands.
  queue.tail = result.then(() => undefined, () => undefined);
  return result;
}
