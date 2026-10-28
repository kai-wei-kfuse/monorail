import type { Card } from './card/card';
import type { TimeEntry } from './timeline/entry';

export interface ReminderPlan { id: string; at: number; title: string; body: string }
export interface ReminderInput {
  cards: Card[]; open: TimeEntry | null;
  deadlineLeadMinutes: number; longActivityMinutes: number;
}

const OPEN_STATUSES: Card['status'][] = ['待做', '进行中'];

/** Plan ids encode their trigger so a changed deadline or a new entry re-arms the reminder. */
export function planReminders({ cards, open, deadlineLeadMinutes, longActivityMinutes }: ReminderInput): ReminderPlan[] {
  const plans: ReminderPlan[] = cards
    .filter(card => card.due_at && OPEN_STATUSES.includes(card.status))
    .map(card => ({
      id: `deadline:${card.id}:${card.due_at}:${deadlineLeadMinutes}`, at: Date.parse(card.due_at!) - deadlineLeadMinutes * 60_000,
      title: '待办期限提醒', body: card.content,
    }));
  if (open) plans.push({
    id: `long:${open.id}:${open.started_at}:${longActivityMinutes}`, at: Date.parse(open.started_at) + longActivityMinutes * 60_000,
    title: '还在做吗', body: `「${open.description}」已经持续 ${Math.round(longActivityMinutes / 60 * 10) / 10} 小时`,
  });
  return plans;
}
