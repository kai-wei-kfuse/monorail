import type { Card } from './card/card';
import type { TimeEntry } from './timeline/entry';

export interface ReminderPlan { id: string; at: number; title: string; body: string }
export interface ReminderInput {
  cards: Card[]; open: TimeEntry | null;
  deadlineLeadMinutes: number; longActivityMinutes: number;
  /**
   * 0.3.1（已定 49 提议 3）：正在计的时间盒卡今天的量。计够时只提醒、不自动停；接着计的照样算进总时长。
   * minutesToday 是到 open.started_at 为止今天已计的分钟（不含正在计的这一段）。
   */
  todayGoal?: { cardId: string; day: string; todayMinutes: number; minutesToday: number; dayStart: number } | null;
  /** 宽松模式（ADR 0021 第 13 条）：待机不排「还在做吗」 */
  loose?: boolean;
}

const OPEN_STATUSES: Card['status'][] = ['待做', '进行中'];

/** Plan ids encode their trigger so a changed deadline or a new entry re-arms the reminder. */
export function planReminders({ cards, open, deadlineLeadMinutes, longActivityMinutes, todayGoal, loose }: ReminderInput): ReminderPlan[] {
  const plans: ReminderPlan[] = cards
    .filter(card => card.due_at && OPEN_STATUSES.includes(card.status))
    .map(card => ({
      id: `deadline:${card.id}:${card.due_at}:${deadlineLeadMinutes}`, at: Date.parse(card.due_at!) - deadlineLeadMinutes * 60_000,
      title: '待办期限提醒', body: card.content,
    }));
  if (open && !(loose && open.project === '待机')) plans.push({
    id: `long:${open.id}:${open.started_at}:${longActivityMinutes}`, at: Date.parse(open.started_at) + longActivityMinutes * 60_000,
    title: '还在做吗', body: `「${open.description}」已经持续 ${Math.round(longActivityMinutes / 60 * 10) / 10} 小时`,
  });
  if (open && todayGoal && open.card_id === todayGoal.cardId && todayGoal.minutesToday < todayGoal.todayMinutes) {
    const card = cards.find(c => c.id === todayGoal.cardId);
    plans.push({
      // 原生侧按 id 记「已经发过」：id 带上开着那条，暂停后再继续是新的一段、会重新排（G5 审核 S3）
      id: `todayGoal:${todayGoal.cardId}:${todayGoal.day}:${todayGoal.todayMinutes}:${open.id}`,
      // 跨夜一直在计时，今天的这一段从今天活动日起点算
      at: Math.max(Date.parse(open.started_at), todayGoal.dayStart) + (todayGoal.todayMinutes - todayGoal.minutesToday) * 60_000,
      title: '今天的量到了', body: `「${card?.content ?? open.description}」今天的 ${todayGoal.todayMinutes} 分钟到了，想接着做也可以`,
    });
  }
  return plans;
}
