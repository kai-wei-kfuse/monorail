// 今日任务板（ADR 0021 第 1、2、6 条，执行方案 G2）：排进今天 / 明天、移出、改量和优先级、这次先不排、换一张、确认带过来的、换日带过去。
// 只依赖 domain 和 tracking/api 的只读查询；不调别的 service（CLAUDE.md 方向表：deal 读、home / card / newDay 调它的 InTx）。
import type { Ctx, Transaction } from './commit';
import { run } from './commit';
import { activityDay } from '../domain/timeline/day';
import { carryItems, defaultTodayMinutes, minutesOnDay, shiftDay, startedBeforeDay, totalMinutes, workable } from '../domain/plan/plan';
import type { DayPlan, PlanItem, PlanPriority } from '../domain/plan/plan';
import { activeRefInTx, insertStateInTx, openInTx } from './tracking/api';
import { drawableCandidates } from '../domain/picker/pick';

export type PlanDay = 'today' | 'tomorrow';
const todayOf = (tx: Transaction) => activityDay(tx.at, tx.settings.dayBoundaryHour);
export function resolvePlanDayInTx(tx: Transaction, day: string, todayOnly = false): PlanDay {
  if (!tx.settings.taskMode) throw new Error('TASK_MODE_OFF：任务模式已关闭，不能操作任务板');
  const today = todayOf(tx), tomorrow = shiftDay(today, 1);
  if (todayOnly) {
    if (day !== today) throw new Error(`PLAN_DAY_CHANGED：只能操作今天的任务板（当前今天为 ${today}，收到 ${day}）`);
    return 'today';
  }
  if (day === today) return 'today';
  if (day === tomorrow) return 'tomorrow';
  throw new Error(`PLAN_DAY_CHANGED：日期 ${day} 不在可修改的今天（${today}）或明天（${tomorrow}）范围内`);
}
export function drawableIdsInTx(tx: Transaction, plan: DayPlan = tx.todayPlan): string[] {
  return drawableCandidates({
    plan,
    cards: tx.cards,
    tasks: tx.tasks,
    entries: tx.entries,
    boundaryHour: tx.settings.dayBoundaryHour,
    at: tx.at,
    activeCard: activeRefInTx(tx),
    inserting: insertStateInTx(tx) !== null,
    legacyRest: tx.state.rest !== null,
  }).map(c => c.card.id);
}
async function planOf(tx: Transaction, which: PlanDay): Promise<DayPlan> {
  return which === 'today' ? tx.todayPlan : tx.plan(shiftDay(todayOf(tx), 1));
}
const cardOf = (tx: Transaction, id: string) => {
  const card = tx.cards.find(item => item.id === id);
  if (!card) throw new Error('卡片不存在');
  return card;
};

export interface AddInput { cardId: string; priority: PlanPriority; todayMinutes?: number | null }
/** 排进今天 / 明天。时间盒没填量时用剩下的时长；结果卡不填。排进今天第一项时清掉「这次先不排」。 */
export async function addInTx(tx: Transaction, which: PlanDay, input: AddInput): Promise<void> {
  const card = cardOf(tx, input.cardId);
  if (!workable(card, tx.tasks)) throw new Error('这张卡不在背包里，不能排进来');
  const plan = structuredClone(await planOf(tx, which));
  if (plan.items.some(item => item.card_id === card.id)) throw new Error(`这张卡已经在${which === 'today' ? '今天' : '明天'}的板子上了`);
  if (card.type !== '时间盒卡' && input.todayMinutes !== undefined && input.todayMinutes !== null) throw new Error('结果卡不填今天的量');
  const minutes = card.type === '时间盒卡'
    ? input.todayMinutes ?? defaultTodayMinutes(card, totalMinutes(tx.entries, card.id, tx.at))
    : null;
  if (minutes !== null && !(Number.isInteger(minutes) && minutes > 0)) throw new Error('今天的量要是正整数分钟');
  plan.items.push({ card_id: card.id, priority: input.priority, today_minutes: minutes, added_at: tx.at, carried: false });
  if (which === 'today') plan.skip_until_planned = false;
  tx.savePlan(plan);
}
export async function removeInTx(tx: Transaction, which: PlanDay, cardId: string): Promise<void> {
  const plan = structuredClone(await planOf(tx, which));
  if (!plan.items.some(item => item.card_id === cardId)) return;
  plan.items = plan.items.filter(item => item.card_id !== cardId);
  plan.seen = plan.seen.filter(id => id !== cardId);
  tx.savePlan(plan);
}
export interface EditInput { cardId: string; priority?: PlanPriority; todayMinutes?: number }
export async function editInTx(tx: Transaction, which: PlanDay, input: EditInput): Promise<void> {
  const plan = structuredClone(await planOf(tx, which));
  const item = plan.items.find(value => value.card_id === input.cardId);
  if (!item) throw new Error('这张卡不在板子上');
  if (input.priority) item.priority = input.priority;
  if (input.todayMinutes !== undefined) {
    if (item.today_minutes === null) throw new Error('结果卡不填今天的量');
    if (!(Number.isInteger(input.todayMinutes) && input.todayMinutes > 0)) throw new Error('今天的量要是正整数分钟');
    item.today_minutes = input.todayMinutes;
  }
  tx.savePlan(plan);
}
/** 缩小拆分时改今天的量（G5 用，ADR 0021 第 4 条）。不在板子上就什么都不做。 */
export function setTodayMinutesInTx(tx: Transaction, cardId: string, minutes: number): void {
  const plan = structuredClone(tx.todayPlan);
  const item = plan.items.find(value => value.card_id === cardId);
  if (!item || item.today_minutes === minutes) return;
  item.today_minutes = minutes;
  tx.savePlan(plan);
}
/** 「这次先不排」：今天还没排时，从整个背包抽；到当天结束或排进第一项为止（已定 49 提议 1）。 */
export function skipTodayInTx(tx: Transaction): void {
  const plan = structuredClone(tx.todayPlan);
  if (plan.skip_until_planned) return;
  plan.skip_until_planned = true;
  tx.savePlan(plan);
}
/**
 * 〔换一张〕（ADR 0021 第 2 条第 6 点，第 3 轮 N4）：这张进 seen。在写事务里重算是否开新一轮：
 * 加上这张以后，板子上能抽的全都在 seen 里，就写成 [这张]。
 */
export function skipCardInTx(tx: Transaction, cardId: string, drawable: (plan: DayPlan) => string[]): void {
  const plan = structuredClone(tx.todayPlan);
  if (!plan.items.some(item => item.card_id === cardId) && !plan.skip_until_planned) return;   // 跨过换日时间时不写进另一天（代码审核 S2）
  const seen = [...new Set([...plan.seen, cardId])];
  const left = drawable({ ...plan, seen }).filter(id => !seen.includes(id));
  plan.seen = left.length ? seen : [cardId];
  tx.savePlan(plan);
}
/** 确认带过来的项（已定 4）：keep 里的留下并转成普通项，其余去掉。 */
export function confirmCarryInTx(tx: Transaction, keep: readonly string[]): void {
  const plan = structuredClone(tx.todayPlan);
  if (plan.carried_confirmed) return;
  plan.items = plan.items.filter(item => !item.carried || keep.includes(item.card_id)).map(item => ({ ...item, carried: false }));
  plan.carried_confirmed = true;
  tx.savePlan(plan);
}

/**
 * 换日（ADR 0021 第 6 条）：在 newDay() 里调用，启动和换日都走这里。今天的板子 rolled_over 为真就什么都不做，
 * 所以同一天重启不重复；前一晚排过的「明天」就是今天这份文件，照样带一次。
 * - 来源：今天之前最近的一份（隔几天才开也只带最近那份），未达成、卡仍在背包、今天还没排的带过来，待确认；
 * - 换日时还在计的卡：直接加进今天（不用确认），只在它开始于今天活动日起点之前时做；
 * - 插入中先结束原任务：由 dayChange 在本函数之前处理（代码审核 B2），这里只看开着的那一条。
 * - 任务模式关掉时整个跳过、不建文件（第 3 轮 N5）。
 */
export async function rolloverInTx(tx: Transaction, sourceDays: readonly string[]): Promise<void> {
  if (!tx.settings.taskMode) return;
  const plan = structuredClone(tx.todayPlan);
  if (plan.rolled_over) return;
  const today = plan.day, boundary = tx.settings.dayBoundaryHour;
  const source = [...sourceDays].filter(day => day < today).sort().at(-1);
  if (source) {
    const from = await tx.plan(source);
    const carried = carryItems({ source: from, today: plan, cards: tx.cards, tasks: tx.tasks, entries: tx.entries, boundaryHour: boundary, at: tx.at });
    if (carried.length) { plan.items.push(...carried); plan.carried_from = source; plan.carried_confirmed = false; }
  }
  const open = openInTx(tx);
  const running = open?.card_id ? tx.cards.find(card => card.id === open.card_id) : undefined;
  if (open && running && startedBeforeDay(open, today, boundary) && workable(running, tx.tasks)) {
    const existing = plan.items.find(item => item.card_id === running.id);
    if (existing) existing.carried = false;
    else {
      const spent = totalMinutes(tx.entries, running.id, tx.at);
      const full = running.type === '时间盒卡' && running.timebox_minutes !== null && spent >= running.timebox_minutes;
      if (!full) plan.items.push({ card_id: running.id, priority: '普通', today_minutes: defaultTodayMinutes(running, spent), added_at: tx.at, carried: false } satisfies PlanItem);
    }
  }
  plan.carried_confirmed = !plan.items.some(item => item.carried);
  plan.rolled_over = true;
  tx.savePlan(plan);
}

/** 今天这张卡已计（投影、抽卡用）。 */
export const minutesTodayInTx = (tx: Transaction, cardId: string) =>
  minutesOnDay(tx.entries, cardId, todayOf(tx), tx.settings.dayBoundaryHour, tx.at);

// ---------- 根动作（界面调用） ----------
const subjectOf = (cardId: string) => ({ type: 'card' as const, id: cardId });
export const add = (ctx: Ctx, which: PlanDay, input: AddInput, at: string) =>
  run(ctx, tx => addInTx(tx, which, input), at, { action: 'plan.add', subject: subjectOf(input.cardId) });
export const remove = (ctx: Ctx, which: PlanDay, cardId: string, at: string) =>
  run(ctx, tx => removeInTx(tx, which, cardId), at, { action: 'plan.remove', subject: subjectOf(cardId) });
export const edit = (ctx: Ctx, which: PlanDay, input: EditInput, at: string) =>
  run(ctx, tx => editInTx(tx, which, input), at, { action: 'plan.edit', subject: subjectOf(input.cardId) });
export const skipToday = (ctx: Ctx, at: string) => run(ctx, async tx => skipTodayInTx(tx), at, { action: 'plan.skip' });
/** 〔换一张〕：跳过这张、这一轮不再出（不累计 skip_count，不推跳过信号，ADR 0021 第 2 条第 6 点）。 */
export const skipCard = (ctx: Ctx, cardId: string, at: string) => run(ctx, async tx => {
  skipCardInTx(tx, cardId, plan => drawableIdsInTx(tx, plan));
}, at, { action: 'plan.skipCard', subject: subjectOf(cardId) });
export const confirmCarry = (ctx: Ctx, keep: readonly string[], at: string) => run(ctx, async tx => confirmCarryInTx(tx, keep), at, { action: 'plan.carry' });
