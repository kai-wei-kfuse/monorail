import type { Card } from '../domain/card/card';
import type { RecordEntry } from '../domain/record/record';
import type { TimeEntry } from '../domain/timeline/entry';
import type { Task } from '../domain/task/task';
import type { Review } from '../domain/review/schedule';
import type { Settings } from '../shared/settings';
import type { FileSystem } from './fs';
import { Journal } from './journal';
import type { Write } from './journal';
import { MdRepo } from './mdRepo';
import type { Entity } from './mdRepo';
import { StateRepo } from './stateRepo';
import type { AppState } from './stateRepo';
import { TimelogV2Repo } from './timelogV2Repo';
import type { DayChange } from './timelogV2Repo';
import { SettingsRepo } from './settingsRepo';
import { cardSchema, recordSchema, taskSchema, reviewSchema } from './schemas';
import { migrateV2 } from './migrations/v2';
import { ReceiptRepo } from './receiptRepo';
import { HistoryRepo } from './historyRepo';
export type { HistoryWrite } from './historyRepo';
import type { OperationReceipt } from '../shared/operation';

export type { Write, AppState, Entity, DayChange };
export interface EntityRepo<T> {
  get(id: string): Promise<Entity<T> | null>;
  list(): Promise<Entity<T>[]>;
  write(value: T, original: Entity<T> | null, body?: string): Promise<Write>;
  remove(original: Entity<T>): Promise<Write>;
  /** 从载入时的原文重新解析出一份独立的值，不受服务就地修改的影响（ADR 0019 第 4 条）。 */
  decode(entity: Entity<T>): T;
}
export interface Repositories {
  receipts: { get(id: string): Promise<OperationReceipt | null>; write(receipt: OperationReceipt): Promise<Write> };
  history: HistoryRepo;
  records: EntityRepo<RecordEntry>;
  cards: EntityRepo<Card>;
  tasks: EntityRepo<Task>;
  reviews: EntityRepo<Review>;
  state: { read(): Promise<AppState>; write(value: AppState): Promise<Write> };
  settings: { read(): Promise<Settings>; write(value: Settings): Promise<Write> };
  times: {
    snapshot(): TimeEntry[];
    between(start: string, end: string): TimeEntry[];
    scan(now: string, boundaryHour: number): Promise<TimeEntry[]>;
    writes(entries: readonly TimeEntry[], now: string, boundaryHour: number): Promise<Write[]>;
    changedDays(entries: readonly TimeEntry[], boundaryHour: number): DayChange[];
  };
  migrate(now: string, id: () => string): ReturnType<typeof migrateV2>;
  transact(id: string, writes: Write[]): Promise<void>;
  recover(): Promise<number>;
}

export function createRepos(fs: FileSystem): Repositories {
  const journal = new Journal(fs), times = new TimelogV2Repo(fs);
  return {
    receipts: new ReceiptRepo(fs), history: new HistoryRepo(fs),
    records: new MdRepo(fs, 'records', recordSchema), cards: new MdRepo(fs, 'cards', cardSchema),
    tasks: new MdRepo(fs, 'tasks', taskSchema), reviews: new MdRepo(fs, 'reviews', reviewSchema),
    state: new StateRepo(fs), times, settings: new SettingsRepo(fs),
    migrate: (now, id) => migrateV2(fs, { now, id }),
    transact: async (id, writes) => { await journal.run(id, writes); times.acceptCommitted(writes); }, recover: () => journal.recover(),
  };
}
