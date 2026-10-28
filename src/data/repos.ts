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
import { SettingsRepo } from './settingsRepo';
import { cardSchema, recordSchema, taskSchema, reviewSchema } from './schemas';
import { migrateV2 } from './migrations/v2';

export type { Write, AppState, Entity };
export interface EntityRepo<T> {
  get(id: string): Promise<Entity<T> | null>;
  list(): Promise<Entity<T>[]>;
  write(value: T, original: Entity<T> | null, body?: string): Promise<Write>;
  remove(original: Entity<T>): Promise<Write>;
}
export interface Repositories {
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
  };
  migrate(now: string, id: () => string): ReturnType<typeof migrateV2>;
  transact(id: string, writes: Write[]): Promise<void>;
  recover(): Promise<number>;
}

export function createRepos(fs: FileSystem): Repositories {
  const journal = new Journal(fs), times = new TimelogV2Repo(fs);
  return {
    records: new MdRepo(fs, 'records', recordSchema), cards: new MdRepo(fs, 'cards', cardSchema),
    tasks: new MdRepo(fs, 'tasks', taskSchema), reviews: new MdRepo(fs, 'reviews', reviewSchema),
    state: new StateRepo(fs), times, settings: new SettingsRepo(fs),
    migrate: (now, id) => migrateV2(fs, { now, id }),
    transact: async (id, writes) => { await journal.run(id, writes); times.acceptCommitted(writes); }, recover: () => journal.recover(),
  };
}
