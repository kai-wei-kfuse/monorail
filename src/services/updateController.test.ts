import { expect, it, vi } from 'vitest';
import type { UpdateState } from '../shared/updates';
import type { UpdatesPort } from '../platform/updater';
import { createUpdateController } from './updateController';
import { createContext } from './commit';
import { createRepos } from '../data/repos';
import { MemoryFs } from '../data/memoryFs';
import { defaults } from '../shared/settings';

const state = (revision: number, phase: UpdateState['phase'] = 'idle', extra: Partial<UpdateState> = {}): UpdateState => ({
  revision,
  phase,
  currentVersion: '0.2.5',
  currentChannel: 'stable',
  selectedChannel: 'stable',
  intent: 'upgrade',
  busy: ['checking', 'downloading', 'verifying', 'preparing', 'installing'].includes(phase),
  step: phase === 'checking' ? 'github' : 'idle',
  downloaded: 0,
  total: null,
  release: null,
  lastBackup: null,
  history: [],
  error: null,
  updatedAt: revision,
  ...extra,
});

function fixture(snapshot: UpdatesPort['snapshot'] = async () => state(0)) {
  let receive: (state: UpdateState) => void = () => {};
  const port: UpdatesPort = {
    snapshot,
    subscribe: async listener => { receive = listener; return () => {}; },
    check: async () => state(1, 'checking'),
    checkStableTarget: async () => state(2, 'available', { intent: 'returnToStable' }),
    setChannel: async channel => state(3, 'idle', { selectedChannel: channel }),
    dismissTarget: async () => state(4, 'idle', { intent: 'upgrade', release: null }),
    download: async () => state(5, 'downloading'),
    prepareInstall: async () => state(6, 'preparing'),
    install: async () => state(7, 'installing'),
    cancelInstall: async () => state(8, 'ready'),
  };
  const ctx = createContext({
    repos: createRepos(new MemoryFs()),
    settings: structuredClone(defaults),
    id: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    publish() {},
    log: async () => {},
    reminders: { update: async () => {} },
  });
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

it('joinBeta switches channel to beta and checks candidates without auto-downloading', async () => {
  const f = fixture(); await f.controller.connect();
  const calls: string[] = [];
  f.port.setChannel = async channel => {
    calls.push(`setChannel:${channel}`);
    return state(12, 'idle', { selectedChannel: channel, release: null });
  };
  f.port.check = async () => {
    calls.push('check');
    return state(13, 'available', {
      selectedChannel: 'beta',
      release: { version: '0.3.0-beta.1', notes: 'Beta 1', channel: 'beta', isDowngrade: false },
    });
  };
  await f.controller.joinBeta();
  expect(calls).toEqual(['setChannel:beta', 'check']);
  expect(f.published.at(-1)).toMatchObject({
    revision: 13,
    selectedChannel: 'beta',
    phase: 'available',
    release: { version: '0.3.0-beta.1', channel: 'beta' },
  });
});

it('leaveBeta persists stable channel and clears uninstalled beta candidate without auto-downgrading', async () => {
  const f = fixture(async () => state(20, 'ready', {
    currentVersion: '0.3.0-beta.1',
    currentChannel: 'beta',
    selectedChannel: 'beta',
    downloaded: 8_000_000,
    total: 8_000_000,
    release: { version: '0.3.0-beta.2', notes: 'Beta 2', channel: 'beta' },
  }));
  await f.controller.connect();
  const checkSpy = vi.spyOn(f.port, 'check');
  const installSpy = vi.spyOn(f.port, 'install');
  f.port.setChannel = async channel => state(21, 'idle', {
    currentVersion: '0.3.0-beta.1',
    currentChannel: 'beta',
    selectedChannel: channel,
    downloaded: 0,
    total: null,
    release: null,
  });
  await f.controller.leaveBeta();
  expect(checkSpy).not.toHaveBeenCalled();
  expect(installSpy).not.toHaveBeenCalled();
  expect(f.published.at(-1)).toMatchObject({
    revision: 21,
    currentChannel: 'beta',
    selectedChannel: 'stable',
    phase: 'idle',
    downloaded: 0,
    release: null,
  });
});

it('checkStableTarget inspects compatible lower stable version and dismissTarget clears it', async () => {
  const f = fixture(async () => state(30, 'idle', {
    currentVersion: '0.3.0-beta.2',
    currentChannel: 'beta',
    selectedChannel: 'stable',
  }));
  await f.controller.connect();
  f.port.checkStableTarget = async () => state(31, 'available', {
    currentVersion: '0.3.0-beta.2',
    currentChannel: 'beta',
    selectedChannel: 'stable',
    intent: 'returnToStable',
    release: {
      version: '0.2.5',
      notes: 'Stable 0.2.5',
      tag: 'v0.2.5',
      releaseId: 430648033,
      channel: 'stable',
      isDowngrade: true,
      compatibility: {
        compatible: true,
        source: 'auditedTable',
        dataSchemaVersion: 2,
        readableDataSchemaVersions: [2],
        reason: '已核验兼容 schema v2',
      },
    },
  });
  await f.controller.checkStableTarget();
  expect(f.published.at(-1)).toMatchObject({
    revision: 31,
    intent: 'returnToStable',
    phase: 'available',
    release: { version: '0.2.5', isDowngrade: true },
  });

  f.port.dismissTarget = async () => state(32, 'idle', {
    currentVersion: '0.3.0-beta.2',
    currentChannel: 'beta',
    selectedChannel: 'stable',
    intent: 'upgrade',
    release: null,
  });
  await f.controller.dismissTarget();
  expect(f.published.at(-1)).toMatchObject({
    revision: 32,
    intent: 'upgrade',
    phase: 'idle',
    release: null,
  });
});
