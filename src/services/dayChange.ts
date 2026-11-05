// 换日（ADR 0021 第 6 条，执行方案 G2）：启动时一次、过换日时间时一次（scheduler），都走 newDay。
// 顺序：想法过期 → 旧版遗留的降级休息 → 插入中且原来那条是昨天的，先结束原任务 → 今日任务板带过去 → 刷新首页状态（保留 first_used_day 与回顾行，第 2 轮 B1）。
// 带过去靠 plans/ 的 rolled_over 每个活动日只做一次，所以同一天重启不会重复。
import type { Ctx, Transaction } from './commit';
import { run } from './commit';
import { expireInTx } from './ideaService';
import { refreshInTx } from './dealService';
import { rolloverInTx } from './planService';
import { settleLegacyRestInTx } from './degradeService';
import { endOriginalInTx } from './homeService';
import { alignInTx } from './cardService';
import { insertStateInTx } from './tracking/api';
import { activityDay } from '../domain/timeline/day';
import { startedBeforeDay } from '../domain/plan/plan';

export async function dayChangeInTx(tx: Transaction): Promise<void> {
  expireInTx(tx);
  settleLegacyRestInTx(tx);
  // 换日时还在插入中：原来那条确实是昨天开始的，就先结束原任务（原卡回待做，按昨天没做完的带过来、等确认）
  const resume = tx.state.resume_entry_id ? tx.entries.find(e => e.id === tx.state.resume_entry_id) : undefined;
  if (insertStateInTx(tx) && resume && startedBeforeDay(resume, activityDay(tx.at, tx.settings.dayBoundaryHour), tx.settings.dayBoundaryHour)) {
    endOriginalInTx(tx); alignInTx(tx);
  }
  await rolloverInTx(tx, await tx.repos.plans.days());
  refreshInTx(tx);
}

export const newDay = (ctx: Ctx, at = ctx.now()) =>
  run(ctx, dayChangeInTx, at, { action: 'system.dayChange', source: { kind: 'system', trigger: 'dayChange' } });
