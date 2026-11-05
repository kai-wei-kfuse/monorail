import { pickFromPlan } from '../domain/picker/pick';
import type { PickResult } from '../domain/picker/pick';
import { reviewUpdates } from '../domain/review/schedule';
import { activityDay } from '../domain/timeline/day';
import { insertState, activeCardOf } from '../domain/timeline/insert';
import type { Ctx, Transaction } from './commit';
import { readSerial, run } from './commit';

/**
 * 首页状态的整理（ADR 0021 第 2 条第 7–9 点）。0.3.1 不再在这里出卡：抽卡只在今日任务板上，结果只读（drawFromPlan）。
 * 保留 first_used_day 与回顾行的建立 / 取代（第 2 轮 B1：这两处只在这里写，删了新目录的回顾就进不去）。
 * home_mode 只写 blank / task；0.3.0 留下的 review / guide 按 blank 处理。current_card 只可能是 null 或一张进行中的卡。
 */
export function refreshInTx(tx: Transaction): void {
  const day = activityDay(tx.at, tx.settings.dayBoundaryHour);
  tx.state.first_used_day ??= day;
  for (const review of reviewUpdates(day, tx.state.first_used_day, tx.settings.reviewWeekday, tx.reviews)) tx.saveReview(review);
  if (tx.state.current_card && !tx.cards.some(card => card.id === tx.state.current_card && card.status === '进行中')) tx.state.current_card = null;
  tx.state.home_mode = tx.state.current_card ? 'task' : 'blank';
}

export const refresh = (ctx: Ctx, at: string) => run(ctx, async tx => refreshInTx(tx), at, { action: 'deal.refresh' });

/**
 * 从今天的板子抽一张（ADR 0021 第 2 条）：排在提交队列上只读，不写盘、不记历史。
 * 界面拿 candidates 做翻卡；〔开始〕走 homeService.startCard，〔换一张〕走 planService.skipCard。
 */
export function drawFromPlan(ctx: Ctx, at = ctx.now()): Promise<PickResult> {
  return readSerial(ctx, async () => {
    const day = activityDay(at, ctx.settings.dayBoundaryHour), snap = ctx.snapshot();
    if (!snap) throw new Error('SNAPSHOT_UNAVAILABLE：单轨还没准备好');
    const { state } = snap, plan = await ctx.repos.plans.read(day), entries = ctx.repos.times.snapshot();
    const cards = snap.cards.map(value => ({ value })), tasks = snap.tasks.map(value => ({ value }));
    const open = entries.find(entry => entry.id === state.open_entry) ?? null;
    const resume = state.resume_entry_id ? entries.find(entry => entry.id === state.resume_entry_id) ?? null : null;
    return pickFromPlan({ plan: plan.value, cards: cards.map(c => c.value), tasks: tasks.map(t => t.value), entries,
      boundaryHour: ctx.settings.dayBoundaryHour, at, activeCard: activeCardOf(open, resume),
      inserting: insertState(open, resume) !== null, legacyRest: state.rest !== null, random: (ctx.random ?? Math.random)() });
  });
}
