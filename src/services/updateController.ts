import type { UpdatesPort } from '../platform/updater';
import type { UpdateChannel, UpdateState } from '../shared/updates';
import type { Ctx } from './commit';
import { installUpdate } from './updateService';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Native snapshots own the workflow. Revisions prevent stale replies from replacing newer events. */
export function createUpdateController({ ctx, updater, publish, connectionError }:
  { ctx: Ctx; updater: UpdatesPort; publish(state: UpdateState): void; connectionError(error: string | null): void }) {
  let revision = -1, generation = 0;
  let off: (() => void) | undefined;
  const receive = (state: UpdateState) => {
    if (state.revision < revision) return;
    revision = state.revision;
    publish(state);
    connectionError(null);
  };
  async function connect() {
    const current = ++generation;
    off?.();
    const unsubscribe = await updater.subscribe(state => { if (generation === current) receive(state); });
    if (current !== generation) { unsubscribe(); return; }
    off = unsubscribe;
    const state = await updater.snapshot();
    if (current === generation) receive(state);
  }
  async function execute(action: () => Promise<UpdateState>) {
    connectionError(null);
    try { receive(await action()); }
    catch (error) {
      try {
        const state = await updater.snapshot();
        receive(state);
        if (state.error?.message !== message(error)) connectionError(message(error));
      } catch (syncError) { connectionError(`${message(error)}；读取后台状态也失败：${message(syncError)}`); }
    }
  }
  const setChannel = (channel: UpdateChannel) => execute(async () => {
    if (!updater.setChannel) throw new Error('当前更新服务不支持切换渠道');
    return updater.setChannel(channel);
  });
  return {
    connect,
    dispose() { generation++; off?.(); off = undefined; },
    check: () => execute(() => updater.check()),
    setChannel,
    joinBeta: () => execute(async () => {
      if (!updater.setChannel) throw new Error('当前更新服务不支持切换渠道');
      const switched = await updater.setChannel('beta');
      receive(switched);
      return updater.check();
    }),
    leaveBeta: () => setChannel('stable'),
    checkStableTarget: () => execute(async () => {
      if (!updater.checkStableTarget) throw new Error('当前更新服务不支持显式选择稳定版本');
      return updater.checkStableTarget();
    }),
    dismissTarget: () => execute(async () => {
      if (!updater.dismissTarget) throw new Error('当前更新服务不支持取消候选版本');
      return updater.dismissTarget();
    }),
    download: () => execute(() => updater.download()),
    install: () => execute(async () => { await installUpdate(ctx, updater); return updater.snapshot(); }),
  };
}
