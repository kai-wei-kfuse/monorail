// compat-craft 的小工具：测试夹具里的 runTx 依赖 vitest，这里给一个不依赖它的版本。
import { run } from '../../src/services/commit';
import type { Ctx, Transaction } from '../../src/services/commit';
export const runTx = <T>(ctx: Ctx, work: (tx: Transaction) => Promise<T>) => run(ctx, work, undefined, { action: 'verification.compat' });
export const settings = null;
