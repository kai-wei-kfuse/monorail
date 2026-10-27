import type { Card } from '../card/card';

export interface Baseline { main: boolean | null; side: boolean }
export function baseline(cards: Card[], day: string, hasMain: boolean): Baseline {
  const done = cards.filter(card => card.status === '已完成' && card.completed_day === day);
  return { main: hasMain ? done.some(card => card.completed_track === '主线') : null, side: done.some(card => card.completed_track === '支线') };
}
