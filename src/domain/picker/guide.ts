import type { Card } from '../card/card';
import type { Task } from '../task/task';
import { inBackpack } from '../task/task';

export type GuideKind = 'firstTask' | 'setMain' | 'splitMain' | 'allDone';
export function guide(cards: Card[], tasks: Task[]): GuideKind {
  const active = tasks.filter(inBackpack), main = active.find(task => task.slot === '主线');
  if (active.length === 0 && !cards.some(card => card.task_id === null)) return 'firstTask';
  if (!main) return 'setMain';
  if (!cards.some(card => card.task_id === main.id)) return 'splitMain';
  return 'allDone';
}
