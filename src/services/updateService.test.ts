import { expect, it, vi } from 'vitest';
import { MemoryFs } from '../data/memoryFs';
import { createRepos } from '../data/repos';
import { defaults } from '../shared/settings';
import { createContext, pauseCommits, run, whenCommitsOpen } from './commit';
import { installUpdate } from './updateService';
import type { UpdateState } from '../shared/updates';

const prepared: UpdateState = { revision: 1, currentVersion: '0.1.1', phase: 'preparing', busy: true, step: 'commits',
  downloaded: 1, total: 1, release: { version: '0.1.2', notes: null }, history: [], updatedAt: 1, error: null };
const installPort = () => ({ prepareInstall: async () => prepared, install: async () => prepared, cancelInstall: async () => ({ ...prepared, phase: 'ready' as const, busy: false }) });

function fixture() {
  return createContext({ repos: createRepos(new MemoryFs()), settings: structuredClone(defaults), id: () => crypto.randomUUID(),
    now: () => new Date().toISOString(), publish() {}, log: async () => {}, reminders: { update: async () => {} } });
}

it('the install barrier drains queued work and rejects new foreground writes', async () => {
  const ctx = fixture(), order: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const first = run(ctx, async () => { await pending; order.push('first'); });
  const second = run(ctx, async () => { order.push('second'); });
  const barrier = pauseCommits(ctx);
  let drained = false;
  void barrier.ready.then(() => { drained = true; });
  await expect(run(ctx, async () => { order.push('rejected'); })).rejects.toThrow('安装更新');
  expect(drained).toBe(false);
  release(); await Promise.all([first, second, barrier.ready]);
  expect(order).toEqual(['first', 'second']);
  barrier.resume();
  await run(ctx, async () => { order.push('resumed'); });
  expect(order).toEqual(['first', 'second', 'resumed']);
});

it('background producers wait through an installation failure and keep their work', async () => {
  const ctx = fixture(), work = vi.fn(() => run(ctx, async () => undefined));
  const barrier = pauseCommits(ctx);
  const pending = whenCommitsOpen(ctx, work);
  await Promise.resolve(); expect(work).not.toHaveBeenCalled();
  barrier.resume(); await pending;
  expect(work).toHaveBeenCalledOnce();
});

it('an installer failure restores normal admission and exposes the original error', async () => {
  const ctx = fixture();
  await expect(installUpdate(ctx, { ...installPort(), install: async () => { throw new Error('installer refused'); } })).rejects.toThrow('installer refused');
  await expect(run(ctx, async () => 'usable')).resolves.toBe('usable');
});

it('a partial commit failure blocks installation instead of reporting a safe drain', async () => {
  const ctx = fixture(), install = vi.fn(async () => prepared);
  vi.spyOn(ctx.repos, 'transact').mockRejectedValueOnce(new Error('partial write'));
  await expect(run(ctx, async () => undefined)).rejects.toThrow('partial write');
  await expect(installUpdate(ctx, { ...installPort(), install })).rejects.toThrow('恢复 journal');
  expect(install).not.toHaveBeenCalled();
});

it('an unknown native install state cannot reopen the write queue', async () => {
  const ctx = fixture();
  const updater = { ...installPort(), install: async () => { throw new Error('IPC disconnected'); },
    cancelInstall: async () => { throw new Error('native state unknown'); } };
  await expect(installUpdate(ctx, updater)).rejects.toThrow('native state unknown');
  await expect(run(ctx, async () => undefined)).rejects.toThrow('安装更新');
});
