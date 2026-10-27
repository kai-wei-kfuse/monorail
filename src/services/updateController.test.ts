import { expect, it, vi } from 'vitest';
import type { UpdateState } from '../shared/updates';
import type { UpdatesPort } from '../platform/updater';
import { createUpdateController } from './updateController';
import { createContext } from './commit';
import { createRepos } from '../data/repos';
import { MemoryFs } from '../data/memoryFs';
import { defaults } from '../shared/settings';

const state = (revision: number, phase: UpdateState['phase'] = 'idle'): UpdateState => ({ revision, phase, currentVersion: '0.1.1',
  busy: ['checking', 'downloading', 'verifying', 'preparing', 'installing'].includes(phase), step: phase === 'checking' ? 'github' : 'idle',
  downloaded: 0, total: null, release: null, history: [], error: null, updatedAt: revision });

function fixture(snapshot: UpdatesPort['snapshot'] = async () => state(0)) {
  let receive: (state: UpdateState) => void = () => {};
  const port: UpdatesPort = { snapshot, subscribe: async listener => { receive = listener; return () => {}; },
    check: async () => state(1, 'checking'), download: async () => state(2, 'downloading'),
    prepareInstall: async () => state(3, 'preparing'), install: async () => state(4, 'installing'), cancelInstall: async () => state(5, 'ready') };
  const ctx = createContext({ repos: createRepos(new MemoryFs()), settings: structuredClone(defaults), id: () => crypto.randomUUID(),
    now: () => new Date().toISOString(), publish() {}, log: async () => {}, reminders: { update: async () => {} } });
  const published: UpdateState[] = [], error = vi.fn();
  const controller = createUpdateController({ ctx, updater: port, publish: value => published.push(value), connectionError: error });
  return { controller, port, published, error, emit: (value: UpdateState) => receive(value) };
}

it('an initial snapshot cannot overwrite a newer pushed state', async () => {
  let resolve!: (state: UpdateState) => void;
  const f = fixture(() => new Promise(done => { resolve = done; }));
  const connecting = f.controller.connect(); await Promise.resolve();
  f.emit(state(8, 'checking')); resolve(state(0)); await connecting;
  expect(f.published.at(-1)).toMatchObject({ revision: 8, phase: 'checking', busy: true });
});

it('repeated checking observes the active task and stale replies cannot clear it', async () => {
  const f = fixture(); await f.controller.connect();
  let finish!: (state: UpdateState) => void;
  f.port.check = () => new Promise(done => { finish = done; });
  const checking = f.controller.check();
  f.emit(state(5, 'checking'));
  f.port.check = async () => state(5, 'checking');
  await f.controller.check();
  expect(f.published.at(-1)?.busy).toBe(true);
  f.emit(state(7, 'downloading')); finish(state(6, 'available')); await checking;
  expect(f.published.at(-1)).toMatchObject({ revision: 7, phase: 'downloading', busy: true });
});

it('an IPC error keeps the real busy phase visible instead of resetting idle', async () => {
  const f = fixture(async () => state(9, 'checking')); await f.controller.connect();
  f.port.check = async () => { throw new Error('IPC connection interrupted'); };
  await f.controller.check();
  expect(f.published.at(-1)).toMatchObject({ phase: 'checking', busy: true });
  expect(f.error).toHaveBeenLastCalledWith('IPC connection interrupted');
});

it('a newly connected view restores ongoing download progress', async () => {
  const f = fixture(async () => ({ ...state(10, 'downloading'), step: 'download', downloaded: 4000, total: 8000 }));
  await f.controller.connect();
  expect(f.published.at(-1)).toMatchObject({ phase: 'downloading', downloaded: 4000, total: 8000 });
});

it('a failed remote check stays a failure with its exact stage', async () => {
  const f = fixture(); await f.controller.connect();
  f.port.check = async () => ({ ...state(11), step: 'github', error: { message: 'GitHub HTTP 404', step: 'github', at: 11 } });
  await f.controller.check();
  expect(f.published.at(-1)).toMatchObject({ phase: 'idle', error: { message: 'GitHub HTTP 404', step: 'github' } });
});
