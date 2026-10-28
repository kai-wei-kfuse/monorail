import { describe, it, expect, vi } from 'vitest';
import { MemoryFs } from '../data/memoryFs';
import { createRepos } from '../data/repos';
import { defaults } from '../shared/settings';
import type { PowerEvent } from '../platform/lifecycle';
import { createContext } from './commit';
import { startScheduler, untilBoundary } from './scheduler';
import { saveRecord, reconcile } from './recordService';
import { start } from './cardService';
import { change } from './settingsService';

function setup(now: () => string) {
  return createContext({ repos: createRepos(new MemoryFs()), settings: structuredClone(defaults), id: () => crypto.randomUUID(), now,
    publish: () => {}, log: async () => {}, reminders: { update: async () => {} } });
}
const offlineIds = async (ctx: ReturnType<typeof setup>) =>
  [...new Set(ctx.repos.times.snapshot().filter(s => s.source === '离线追问').map(s => s.id))];

describe('scheduler', () => {
  it('changing the boundary immediately rearms its existing timer and disposal removes the subscription', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 27, 3, 0));
      const ctx = setup(() => new Date().toISOString()), days: string[] = [];
      const stop = await startScheduler(ctx, {
        lifecycle: { read: async () => ({ last_alive: 0, previous_last_alive: null, startup_at: 0, events: [] }), onPower: async () => () => {} },
        onDayChanged: async day => { days.push(day); }, report: e => { throw e; },
      });
      await change(ctx, 'dayBoundaryHour', 5, ctx.now());
      await vi.advanceTimersByTimeAsync(60 * 60_000 + 1000); expect(days).toEqual([]);
      await vi.advanceTimersByTimeAsync(60 * 60_000); expect(days).toEqual(['2026-10-27']);
      stop(); await change(ctx, 'dayBoundaryHour', 6, ctx.now()); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('computes the wait until the next local boundary', () => {
    expect(untilBoundary(new Date(2026, 9, 27, 3, 0).toISOString(), 4)).toBe(60 * 60_000);
    expect(untilBoundary(new Date(2026, 9, 27, 4, 0).toISOString(), 4)).toBe(24 * 60 * 60_000);
  });
  it('settles the shutdown gap on startup and a sleep gap on resume', async () => {
    const ctx = setup(() => '2026-10-27T12:00:00.000Z');
    let power: (e: PowerEvent) => void = () => {};
    const stop = await startScheduler(ctx, {
      lifecycle: {
        read: async () => ({ last_alive: 0, previous_last_alive: Date.parse('2026-10-27T01:00:00Z'), startup_at: Date.parse('2026-10-27T08:00:00Z'), events: [] }),
        onPower: async handler => { power = handler; return () => {}; },
      },
      onDayChanged: async () => {}, report: e => { throw e; },
    });
    expect(await offlineIds(ctx)).toHaveLength(1);
    power({ kind: 'resume', at: 0, simulated: true, suspended_at: Date.parse('2026-10-27T09:00:00Z'), resumed_at: Date.parse('2026-10-27T10:00:00Z') });
    await vi.waitFor(async () => expect(await offlineIds(ctx)).toHaveLength(2));
    stop();
  });
  it('one shutdown gap stays one logical interval when split at the activity-day boundary', async () => {
    const startAt = new Date(2026, 9, 27, 3).getTime(), endAt = new Date(2026, 9, 27, 5).getTime();
    const ctx = setup(() => new Date(endAt).toISOString());
    const stop = await startScheduler(ctx, {
      lifecycle: { read: async () => ({ last_alive: 0, previous_last_alive: startAt, startup_at: endAt, events: [] }), onPower: async () => () => {} },
      onDayChanged: async () => {}, report: error => { throw error; },
    });
    const physical = ctx.repos.times.snapshot().filter(entry => entry.source === '离线追问');
    expect(physical).toHaveLength(1);
    expect(await offlineIds(ctx)).toHaveLength(1);
    stop();
  });
  it('a startup gap releases the running card and re-deals it as 待开始', async () => {
    const ctx = setup(() => '2026-10-27T12:00:00.000Z'), id = crypto.randomUUID();
    await saveRecord(ctx, { id, text: '学 Python', kind: '待办', created_at: '2026-10-27T07:00:00Z', due_at: null, blocking: false, task_id: null, card_id: null, tags: [], attachments: [] });
    await reconcile(ctx);
    await start(ctx, `card-${id}`, '2026-10-27T07:30:00Z');
    const stop = await startScheduler(ctx, {
      lifecycle: { read: async () => ({ last_alive: 0, previous_last_alive: Date.parse('2026-10-27T08:00:00Z'), startup_at: Date.parse('2026-10-27T11:00:00Z'), events: [] }), onPower: async () => () => {} },
      onDayChanged: async () => {}, report: e => { throw e; },
    });
    const state = await ctx.repos.state.read();
    expect((await ctx.repos.cards.get(`card-${id}`))?.value.status).toBe('待做');
    expect(state).toMatchObject({ home_mode: 'blank', current_card: null });
    stop();
  });
  it('reports a day change once when the boundary has passed', async () => {
    let now = new Date(2026, 9, 27, 3, 59).toISOString();
    const ctx = setup(() => now), days: string[] = [];
    let power: (e: PowerEvent) => void = () => {};
    const stop = await startScheduler(ctx, {
      lifecycle: { read: async () => ({ last_alive: 0, previous_last_alive: null, startup_at: 0, events: [] }), onPower: async h => { power = h; return () => {}; } },
      onDayChanged: async day => { days.push(day); }, report: e => { throw e; },
    });
    now = new Date(2026, 9, 27, 4, 1).toISOString();
    const at = Date.parse(now);
    power({ kind: 'resume', at, simulated: true, suspended_at: at - 60_000, resumed_at: at });
    await vi.waitFor(() => expect(days).toEqual(['2026-10-27']));
    stop();
  });
});
