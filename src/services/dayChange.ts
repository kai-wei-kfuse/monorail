// 换日（ADR 0021 第 6 条，执行方案 G2）：启动时一次、过换日时间时一次（scheduler），都走 newDay。
// 顺序：想法过期 → 旧版遗留的降级休息（G5 补）→ 今日任务板带过去 → 刷新首页状态（保留 first_used_day 与回顾行，第 2 轮 B1）。
// 带过去靠 plans/ 的 rolled_over 每个活动日只做一次，所以同一天重启不会重复。
import type { Ctx, Transaction } from './commit';
import { run } from './commit';
import { expireInTx } from './ideaService';
import { refreshInTx } from './dealService';
import { rolloverInTx } from './planService';

export async function dayChangeInTx(tx: Transaction): Promise<void> {
  expireInTx(tx);
  await rolloverInTx(tx, await tx.repos.plans.days());
  refreshInTx(tx);
}

export const newDay = (ctx: Ctx, at = ctx.now()) =>
  run(ctx, dayChangeInTx, at, { action: 'system.dayChange', source: { kind: 'system', trigger: 'dayChange' } });
