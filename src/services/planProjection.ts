// 今日任务板的投影（执行方案 G2）：提交后整块重算今天、明天两块板子；心跳只由界面按秒补正在计那一行（R5）。
import type { Card } from '../domain/card/card';
import type { Task } from '../domain/task/task';
import { trackOf } from '../domain/task/task';
import type { TimeEntry } from '../domain/timeline/entry';
import { achieved, dueOn, minutesOnDay, visibleItems } from '../domain/plan/plan';
import type { DayPlan } from '../domain/plan/plan';
import type { PlanBoard, PlanSlice } from '../store/planSlice';
import { drawableOnPlan } from '../domain/picker/pick';

export interface PlanProjectionInput {
  today: DayPlan; tomorrow: DayPlan; cards: readonly Card[]; tasks: readonly Task[];
  entries: readonly TimeEntry[]; runningCard: string | null; boundaryHour: number; at: string;
}

function board(plan: DayPlan, input: PlanProjectionInput, isToday: boolean): PlanBoard {
  const cards = new Map(input.cards.map(card => [card.id, card])), tasks = new Map(input.tasks.map(task => [task.id, task]));
  const rows = visibleItems(plan, input.cards, input.tasks).map(item => {
    const card = cards.get(item.card_id)!, task = card.task_id ? tasks.get(card.task_id) : undefined;
    const minutes = isToday ? minutesOnDay(input.entries, card.id, plan.day, input.boundaryHour, input.at) : 0;
    return {
      cardId: card.id, title: card.content, taskName: task && task.name !== card.content ? task.name : null,
      track: trackOf(card.task_id, [...input.tasks]), priority: item.priority, type: card.type,
      todayMinutes: item.today_minutes, minutesToday: Math.floor(minutes),
      achieved: isToday && achieved(item, card, minutes), running: isToday && input.runningCard === card.id,
      carried: item.carried, dueThatDay: dueOn(card, plan.day, input.boundaryHour),
    };
  });
  return { day: plan.day, rows, achieved: rows.filter(row => row.achieved).length, total: rows.length,
    skipUntilPlanned: plan.skip_until_planned, carryPending: !plan.carried_confirmed && rows.some(row => row.carried), carriedFrom: plan.carried_from,
    drawable: isToday ? drawableOnPlan({ plan, cards: input.cards, tasks: input.tasks, entries: input.entries, boundaryHour: input.boundaryHour, at: input.at, activeCard: input.runningCard }).map(c => c.card.id) : [] };
}

export function projectPlan(input: PlanProjectionInput): PlanSlice {
  return { today: board(input.today, input, true), tomorrow: board(input.tomorrow, input, false) };
}
