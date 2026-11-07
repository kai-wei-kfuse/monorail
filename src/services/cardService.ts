import type { Card } from '../domain/card/card';
import { editCardContent, cardTiming } from '../domain/card/edit';
import { startCard, completeCard, completeCardItem, releaseCard, abandonCard } from '../domain/card/transitions';
import { splitCard, restoreParent } from '../domain/card/shrink';
import { splitInputs } from '../domain/plan/plan';
import { minTodayMinutes } from '../domain/card/shrink';
import { setTodayMinutesInTx } from './planService';
import type { Task } from '../domain/task/task';
import { inBackpack, trackOf } from '../domain/task/task';
import { activityDay } from '../domain/timeline/day';
import type { Ctx, Transaction } from './commit';
import { readSerial, run } from './commit';
import type { HistorySource } from '../shared/history';
import { openInTx, startRefInTx, stopRefInTx, renameRefInTx, retagRefInTx, activeRefInTx, refElapsedInTx, insertStateInTx } from './tracking/api';
import { afterItem } from '../domain/task/pool';
import { refreshInTx } from './dealService';

function getCard(tx: Transaction, id: string): Card {
  const card = tx.cards.find(item => item.id === id);
  if (!card) throw new Error('卡片不存在');
  return card;
}
function restoreInTx(tx: Transaction, card: Card): void {
  if (!card.shrunk_from) return;
  const parent = getCard(tx, card.shrunk_from);
  // A child may move to another task; finishing it cannot revive an abandoned ancestor.
  if (parent.status === '已缩小') tx.saveCard(restoreParent(card, parent, card.progress_note));
}
function requireCurrent(tx: Transaction, card: Card): void {
  if (tx.state.current_card !== card.id || tx.state.rest) throw new Error('首页卡片已改变');
}
function target(tx: Transaction, card: Card) {
  const { project, tags } = cardTiming(card, tx.tasks.find(task => task.id === card.task_id));
  return { description: card.content.replace(/[[\]]/g, ''), project, card_id: card.id, tags };
}
export const templateInTx = target;
export function alignInTx(tx: Transaction): void {
  const active = activeRefInTx(tx);
  for (const card of tx.cards.filter(card => card.status === '进行中' && card.id !== active)) {
    tx.saveCard(releaseCard(card));
    if (tx.state.current_card === card.id) { tx.state.current_card = null; tx.state.home_mode = 'blank'; }
  }
}
function finishItemInTx(tx: Transaction, card: Card): void {
  const task = tx.tasks.find(task => task.id === card.task_id);
  if (task) tx.saveTask(afterItem(task, tx.cards, tx.at));
}

export function editContentInTx(tx: Transaction, cardId: string, content: string): void {
  const card = editCardContent(getCard(tx, cardId), content);
  tx.saveCard(card); renameRefInTx(tx, cardId, target(tx, card).description);
}
export const editContent = (ctx: Ctx, cardId: string, content: string, at: string) => run(ctx, async tx => editContentInTx(tx, cardId, content), at, { action: 'card.editContent' });
export function editMetaInTx(tx: Transaction, cardId: string, project: string | null, tags: string[]): void {
  const next = { ...getCard(tx, cardId), project, tags: [...tags] }; tx.saveCard(next);
  const value = target(tx, next); retagRefInTx(tx, cardId, value.project, value.tags);
}

export async function startCardInTx(tx: Transaction, cardId: string, from = tx.at): Promise<void> {
  // 插入中（ADR 0021 第 3 条，已定 20）：开始的正是原来那张卡 =〔回到任务〕（清回到目标，同 homeService.resumeInTx）；别的卡拒绝
  if (insertStateInTx(tx)) {
    const resume = tx.entries.find(e => e.id === tx.state.resume_entry_id);
    if (resume?.card_id !== cardId) throw new Error('IN_AWAY_ACTIVITY：正在插入别的事，先回到任务或结束原任务，再开始另一张卡');
    tx.state.resume_entry_id = null;
  }
  const card = getCard(tx, cardId), current = openInTx(tx);
  if (card.status === '进行中' && current?.card_id === cardId) return;
  for (const other of tx.cards.filter(item => item.status === '进行中' && item.id !== cardId)) tx.saveCard(releaseCard(other));
  if (card.task_id && !tx.tasks.some(task => task.id === card.task_id && inBackpack(task))) throw new Error('项目不在背包');
  tx.saveCard(startCard(card));
  startRefInTx(tx, cardId, target(tx, card), from);
  tx.state.current_card = cardId;
  tx.state.home_mode = 'task';
  tx.state.rest = null;
  alignInTx(tx);
}
export const start = (ctx: Ctx, cardId: string, at: string) => run(ctx, tx => startCardInTx(tx, cardId), at, { action: 'card.start' });

/** Read-only prompt calculation, using the original click time and effective history. */
export async function checkComplete(ctx: Ctx, cardId: string, at: string): Promise<{ remainingMinutes: number; at: string }> {
  const entity = await ctx.repos.cards.get(cardId);
  if (!entity) throw new Error('卡片不存在');
  const card = entity.value;
  const elapsed = refElapsedInTx({ entries: ctx.repos.times.snapshot(), at }, cardId);
  return { remainingMinutes: card.type === '时间盒卡' ? Math.max(0, (card.timebox_minutes ?? 0) - elapsed / 60000) : 0, at };
}

/**
 * 打开缩小对话框时现算今天的量和今天这份的下限（只读，同 checkComplete；G6 审核 S2）。
 * 结果卡 todayGoal 为 null。和 split 同一个 splitInputs，点〔缩小〕时滑块的下限就是服务端会接受的下限。
 */
export function checkSplit(ctx: Ctx, cardId: string, at: string): Promise<{ todayGoal: number | null; minToday: number; minutesToday: number }> {
  return readSerial(ctx, async () => {
    const entity = await ctx.repos.cards.get(cardId);
    if (!entity) throw new Error('卡片不存在');
    const plan = await ctx.repos.plans.read(activityDay(at, ctx.settings.dayBoundaryHour));
    const { todayGoal, minutesToday } = splitInputs(entity.value, plan.value, ctx.repos.times.snapshot(), ctx.settings.dayBoundaryHour, at);
    return { todayGoal, minToday: minTodayMinutes(minutesToday), minutesToday };
  });
}

/** 小窗点完成、主窗口弹完成对话框（两段式）：调用方传 source 把来源记成小窗（执行方案 E8a3）。 */
export const complete = (ctx: Ctx, cardId: string, at: string, note: string, keepGoing = false, source?: HistorySource) => keepGoing
  ? keepGoingCard(ctx, cardId, at, note, source)
  : run(ctx, async tx => {
  const card = getCard(tx, cardId);
  if (card.status === '已完成') return;
  requireCurrent(tx, card);
  const done = completeCard(card, at, activityDay(at, tx.settings.dayBoundaryHour), trackOf(card.task_id, tx.tasks), note);
  tx.saveCard(done);
  restoreInTx(tx, done);
  stopRefInTx(tx, cardId);
  // 完成后不自动抽（ADR 0021 第 2 条第 7 点），回到空卡区
  tx.state.current_card = null; tx.state.home_mode = 'blank';
  finishItemInTx(tx, done); alignInTx(tx);
}, at, { action: 'card.complete', subject: { type: 'card', id: cardId }, ...(source ? { source } : {}) });

export interface CompleteTaskItemInput {
  cardId: string;
  note?: string;
  finishEarly?: boolean;
}
export interface CompleteTaskItemResult {
  noop: boolean;
  card: Card;
  task: Task | null;
  remainingMinutes: number;
}

/**
 * 0.3.2（ADR 0022 §3b.2，S1/S4/S5）：单子项完成事务，供任务详情单行〔完成〕与自动化 `complete_task_item` 共用。
 * - 严格按实体存在 → 父任务冷藏/已放弃拒绝（TASK_NOT_ACTIVE）→ 已完成子项立即幂等 noop（含父支线刚因该尾项完成而自动变为已完成）→ 父任务 inBackpack → 待做/进行中校验。
 * - 非当前首页关联卡直接从待做标为已完成，不触碰正在运行的其他卡/自由计时/插入事件。
 * - 当前首页卡（含运行中与卡自身暂停）或插入等待原卡：拦截 IN_AWAY_ACTIVITY / PENDING_START_CONFIRMATION / IN_REST_MODE，
 *   时间盒未达目标时长时要求 finishEarly=true（TIMEBOX_NOT_REACHED），通过后停止该卡计时并清空首页当前卡。
 */
export function completeTaskItemInTx(tx: Transaction, input: CompleteTaskItemInput): CompleteTaskItemResult {
  const card = tx.cards.find(item => item.id === input.cardId);
  if (!card) throw new Error('CARD_NOT_FOUND：卡片不存在');
  let task: Task | null = null;
  if (card.task_id !== null) {
    task = tx.tasks.find(item => item.id === card.task_id) ?? null;
    if (!task) throw new Error('TASK_NOT_FOUND：任务不存在');
    if (task.status === '冷藏' || task.status === '已放弃') {
      throw new Error('TASK_NOT_ACTIVE：所属任务已冷藏或已放弃，不能完成事项');
    }
  }
  if (card.status === '已完成') {
    return { noop: true, card, task, remainingMinutes: 0 };
  }
  if (task && !inBackpack(task)) {
    throw new Error('TASK_NOT_ACTIVE：所属任务不在背包进行中，不能完成事项');
  }
  if (card.status !== '待做' && card.status !== '进行中') {
    throw new Error('CARD_NOT_ACTIVE：只有待做或进行中的事项可以完成');
  }

  const open = openInTx(tx);
  const resume = tx.state.resume_entry_id ? tx.entries.find(e => e.id === tx.state.resume_entry_id) : undefined;
  const isAwayTarget = Boolean(insertStateInTx(tx) && (resume?.card_id === card.id || tx.state.current_card === card.id));
  if (isAwayTarget) {
    throw new Error('IN_AWAY_ACTIVITY：正在插入别的事，先回到任务或结束原任务，再完成事项');
  }

  const isCurrentHomeCard =
    tx.state.current_card === card.id ||
    open?.card_id === card.id ||
    Boolean(open?.kind === '暂停' && resume?.card_id === card.id);

  let remainingMinutes = 0;
  if (isCurrentHomeCard) {
    if (tx.state.rest) {
      throw new Error('IN_REST_MODE：正在休息，请先从休息返回');
    }
    if (tx.state.pending_id || tx.state.pending_at) {
      throw new Error('PENDING_START_CONFIRMATION：当前卡片正在等待开始确认，请先确认或取消');
    }
    const elapsed = refElapsedInTx(tx, card.id);
    remainingMinutes = card.type === '时间盒卡' ? Math.max(0, (card.timebox_minutes ?? 0) - elapsed / 60000) : 0;
    if (remainingMinutes > 0 && !input.finishEarly) {
      throw new Error(`TIMEBOX_NOT_REACHED：时间盒还差 ${Math.ceil(remainingMinutes)} 分钟（目标 ${card.timebox_minutes} 分钟），若要提前完成请确认 finish_early=true`);
    }
  }

  const day = activityDay(tx.at, tx.settings.dayBoundaryHour);
  const track = task ? task.slot : trackOf(card.task_id, tx.tasks);
  const done = completeCardItem(card, tx.at, day, track, input.note);
  tx.saveCard(done);
  restoreInTx(tx, done);

  if (isCurrentHomeCard || card.status === '进行中') {
    if (open?.card_id === card.id || (open?.kind === '暂停' && resume?.card_id === card.id)) {
      stopRefInTx(tx, card.id);
    }
    if (tx.state.current_card === card.id) {
      tx.state.current_card = null;
      tx.state.home_mode = 'blank';
    }
  }

  finishItemInTx(tx, done);
  alignInTx(tx);
  refreshInTx(tx);
  const updatedTask = card.task_id ? tx.tasks.find(item => item.id === card.task_id) ?? null : null;
  return { noop: false, card: done, task: updatedTask, remainingMinutes };
}

export const completeItem = (
  ctx: Ctx,
  cardId: string,
  at: string,
  options?: { note?: string; finishEarly?: boolean; source?: HistorySource },
) => run(
  ctx,
  async tx => completeTaskItemInTx(tx, { cardId, note: options?.note, finishEarly: options?.finishEarly }),
  at,
  { action: 'card.complete', subject: { type: 'card', id: cardId }, ...(options?.source ? { source: options.source } : {}) },
);

/**
 * 接着做（已定 5，ADR 0021 第 5 条）：同一张卡，不记完成；写「做到哪了」，回待做，停计时。不再新建续卡。
 * 板子上这一项留着（时间盒今天没计够的还能抽到）。current_card 一起清掉（第 2 轮 N3）。
 */
export function keepGoingInTx(tx: Transaction, cardId: string, note: string): void {
  const card = getCard(tx, cardId);
  if (card.status !== '进行中' && card.status !== '待做') throw new Error('这张卡已经不在做了');
  tx.saveCard(releaseCard({ ...card, progress_note: note }));
  stopRefInTx(tx, cardId);
  tx.state.current_card = null; tx.state.home_mode = 'blank';
  alignInTx(tx);
}
export function keepGoingCheckedInTx(tx: Transaction, input: { cardId: string; note?: string }): Card {
  if (!tx.settings.taskMode) throw new Error('TASK_MODE_OFF：任务模式已关闭，不能操作事项卡片');
  if (tx.state.rest) throw new Error('IN_REST_MODE：正在休息，请先从休息返回');
  if (tx.state.pending_id || tx.state.pending_at) throw new Error('PENDING_START_CONFIRMATION：当前卡片正在等待开始确认，请先确认或取消');
  if (insertStateInTx(tx)) throw new Error('IN_AWAY_ACTIVITY：正在插入别的事，先回到任务或结束原任务');
  const card = tx.cards.find(item => item.id === input.cardId);
  if (!card) throw new Error('CARD_NOT_FOUND：卡片不存在');
  if (tx.state.current_card !== card.id) throw new Error('NOT_CURRENT_CARD：首页卡片已改变，只有当前首页正在做或暂停的卡片可以记录进度暂停（接着做）');
  const nextNote = input.note !== undefined ? input.note : card.progress_note;
  keepGoingInTx(tx, card.id, nextNote);
  refreshInTx(tx);
  return getCard(tx, card.id);
}
const keepGoingCard = (ctx: Ctx, cardId: string, at: string, note: string, source?: HistorySource) => run(ctx, async tx => {
  const card = getCard(tx, cardId);
  if (card.status === '已完成') return;
  requireCurrent(tx, card);
  if (insertStateInTx(tx)) throw new Error('IN_AWAY_ACTIVITY：正在插入别的事，先回到任务再继续');
  keepGoingInTx(tx, cardId, note);
}, at, { action: 'card.keepGoing', subject: { type: 'card', id: cardId }, ...(source ? { source } : {}) });

/**
 * 缩小 = 拆成两张（已定 50、54，ADR 0021 第 4 条）：原卡改成「今天做的」接着计，「剩下的」是新卡排在后面、不在板子上。
 * 时间盒的「原今天的量」取板子上的 today_minutes；不在板子上时取剩下的时长（第 1 轮 S6）。不设级数上限，也不再计拒绝次数。
 */
export interface SplitCommand { todayContent: string; restContent: string; restMinutes: number | null }
export function splitInTx(tx: Transaction, cardId: string, input: SplitCommand, options?: { requireTaskMode?: boolean }): { todayCard: Card; restCard: Card; todayMinutes: number | null } {
  if (options?.requireTaskMode && !tx.settings.taskMode) throw new Error('TASK_MODE_OFF：任务模式已关闭，不能拆分事项卡片');
  if (tx.state.rest) throw new Error('IN_REST_MODE：正在休息，请先从休息返回');
  if (tx.state.pending_id || tx.state.pending_at) throw new Error('PENDING_START_CONFIRMATION：当前卡片正在等待开始确认，请先确认或取消');
  const card = tx.cards.find(item => item.id === cardId);
  if (!card) throw new Error('CARD_NOT_FOUND：卡片不存在');
  requireCurrent(tx, card);
  if (insertStateInTx(tx)) throw new Error('IN_AWAY_ACTIVITY：正在插入别的事，先回到任务再缩小');
  const { todayGoal, minutesToday, minutesTotal } = splitInputs(card, tx.todayPlan, tx.entries, tx.settings.dayBoundaryHour, tx.at);
  // 取原卡和后一张之间的中点。同一处连拆大约 50 次后会碰到浮点精度，实际用不到；reorderQueue 重排时会把序号排回整数（G6 审核 N4）
  const next = Math.min(...tx.cards.filter(c => c.order > card.order).map(c => c.order), card.order + 1);
  const result = splitCard(card, { ...input, id: tx.id(), at: tx.at, order: (card.order + next) / 2, todayGoal, minutesToday, minutesTotal });
  // 原卡内容改了：经 editContentInTx，开着的那条计时描述跟着改（之前的条目保留旧描述）；再写时长和级数
  editContentInTx(tx, cardId, result.today.content);
  tx.saveCard({ ...getCard(tx, cardId), timebox_minutes: result.today.timebox_minutes, shrink_level: result.today.shrink_level, skip_count: 0 });
  tx.saveCard(result.rest);
  if (result.todayMinutes !== null) setTodayMinutesInTx(tx, cardId, result.todayMinutes);
  alignInTx(tx);
  refreshInTx(tx);
  return { todayCard: getCard(tx, cardId), restCard: result.rest, todayMinutes: result.todayMinutes };
}
export const split = (ctx: Ctx, cardId: string, input: SplitCommand, at: string) => run(ctx, async tx => {
  const { restCard } = splitInTx(tx, cardId, input);
  return restCard.id;
}, at, { action: 'card.split', subject: { type: 'card', id: cardId } });


export const pass = (ctx: Ctx, cardId: string, at: string) => run(ctx, async tx => {
  const card = getCard(tx, cardId);
  if (card.status === '已放弃') return;
  tx.saveCard(abandonCard(card)); restoreInTx(tx, card);
  if (tx.state.current_card === cardId) {
    tx.state.current_card = null;
    stopRefInTx(tx, cardId);
  }
  if (!tx.state.current_card) tx.state.home_mode = 'blank';
  finishItemInTx(tx, card); alignInTx(tx);
}, at, { action: 'card.pass' });


