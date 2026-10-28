import type { Card } from '../domain/card/card';
import type { RecordEntry } from '../domain/record/record';
import type { Segment } from '../domain/timeline/segment';
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
import { TimelogRepo } from './timelogRepo';
import { SettingsRepo } from './settingsRepo';
import { cardSchema, recordSchema, taskSchema, reviewSchema } from './schemas';
import { taskReferenceFields, reviewTaskFields } from './v1Codec';

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
    snapshot(): Segment[];
    readDay(day: string): Promise<Segment[]>;
    readDays(days: string[]): Promise<Segment[]>;
    scan(): Promise<{ day: string; segments: Segment[] }[]>;
    writes(changes: { day: string; segment: Segment }[]): Promise<Write[]>;
  };
  transact(id: string, writes: Write[]): Promise<void>;
  recover(): Promise<number>;
}

export function createRepos(fs: FileSystem): Repositories {
  const journal = new Journal(fs), times = new TimelogRepo(fs);
  return {
    records: new MdRepo(fs, 'records', recordSchema, taskReferenceFields), cards: new MdRepo(fs, 'cards', cardSchema, taskReferenceFields),
    tasks: new MdRepo(fs, 'projects', taskSchema), reviews: new MdRepo(fs, 'reviews', reviewSchema, reviewTaskFields),
    state: new StateRepo(fs), times, settings: new SettingsRepo(fs),
    transact: async (id, writes) => { await journal.run(id, writes); times.acceptCommitted(writes); }, recover: () => journal.recover(),
  };
}
