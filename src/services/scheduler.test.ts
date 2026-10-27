import { describe, it, expect, vi } from 'vitest';
import { MemoryFs } from '../data/memoryFs';
import { createRepos } from '../data/repos';
import { defaults } from '../shared/settings';
import type { PowerEvent } from '../platform/lifecycle';
import { createContext } from './commit';
import { startScheduler, untilBoundary } from './scheduler';

function setup(now: () => string) {
  return createContext({ repos: createRepos(new MemoryFs()), settings: structuredClone(defaults), id: () => crypto.randomUUID(), now,
    publish: () => {}, log: async () => {}, reminders: { update: async () => {} } });
}
const offline = async (ctx: ReturnType<typeof setup>) =>
  (await ctx.repos.times.scan()).flatMap(d => d.segments).filter(s => s.source === '离线追问');

describe('scheduler', () => {
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
    expect(await offline(ctx)).toHaveLength(1);
    power({ kind: 'resume', at: 0, simulated: true, suspended_at: Date.parse('2026-10-27T09:00:00Z'), resumed_at: Date.parse('2026-10-27T10:00:00Z') });
    await vi.waitFor(async () => expect(await offline(ctx)).toHaveLength(2));
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
