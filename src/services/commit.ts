import type { Card } from '../domain/card/card';
import type { RecordEntry } from '../domain/record/record';
import type { Segment } from '../domain/timeline/segment';
import type { Settings } from '../shared/settings';
import type { Reminders } from '../platform/reminders';
import type { FileSystem } from '../data/fs';
import type { AppState } from '../data/stateRepo';
import type { Write } from '../data/journal';
import { StateRepo } from '../data/stateRepo';
import { TimelogRepo } from '../data/timelogRepo';
import { MdRepo } from '../data/mdRepo';
import { Journal } from '../data/journal';
import { cardSchema, recordSchema } from '../data/schemas';

export interface Snapshot { state: AppState; cards: Card[]; segments: Segment[] }
export interface Ctx {
  fs: FileSystem; records: MdRepo<RecordEntry>; cards: MdRepo<Card>; times: TimelogRepo;
  state: StateRepo; journal: Journal; settings: Settings; reminders: Reminders;
  id(): string; now(): string; publish(snapshot: Snapshot): void; log(message: string): Promise<void>;
  commit<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
export interface Transaction { state: AppState; segments: Segment[]; writes: Write[]; nextSeq(): number }

export function createContext(options: Pick<Ctx, 'fs' | 'settings' | 'reminders' | 'id' | 'now' | 'publish' | 'log'>): Ctx {
  let tail: Promise<unknown> = Promise.resolve();
  let failed: unknown;
  const ctx: Ctx = {
    ...options, records: new MdRepo(options.fs, 'records', recordSchema), cards: new MdRepo(options.fs, 'cards', cardSchema),
    times: new TimelogRepo(options.fs), state: new StateRepo(options.fs), journal: new Journal(options.fs),
    commit<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
      const result = tail.then(async () => {
        if (failed) throw new Error('提交已阻塞；请重启以恢复 journal', { cause: failed });
        const state = await ctx.state.read(), segments = await ctx.times.all();
        if (segments.some(s => s.seq > state.max_seq)) throw new Error('state.max_seq 落后于计时记录');
        const tx: Transaction = { state: { ...state }, segments, writes: [], nextSeq() { return ++this.state.max_seq; } };
        const value = await work(tx);
        tx.writes.push(await ctx.state.write(tx.state));
        try { await ctx.journal.run(ctx.id(), tx.writes); }
        catch (error) { failed = error; throw error; }
        const cards = (await ctx.cards.list()).map(e => e.value);
        ctx.publish({ state: tx.state, cards, segments: await ctx.times.all() });
        await ctx.reminders.update(cards.filter(c => c.due_at && c.status !== '已完成').map(c => ({
          id: `deadline:${c.id}:${c.due_at}`, at: Date.parse(c.due_at!) - ctx.settings.deadlineLeadMinutes * 60_000,
          title: '待办期限提醒', body: c.content,
        })));
        return value;
      });
      // The caller receives rejection. Drain the scheduling tail so a rejected
      // pre-write command does not disable valid commands; journal failures require recovery.
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  return ctx;
}
