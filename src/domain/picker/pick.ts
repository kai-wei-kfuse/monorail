import type { Card } from '../card/card';
import type { Project } from '../project/project';
import { inBackpack } from '../project/project';
import { baseline } from '../baseline/baseline';
import { guide } from './guide';
import type { GuideKind } from './guide';
import type { ReviewDue } from '../review/schedule';

export interface PickInput {
  cards: Card[]; projects: Project[]; day: string; at: string; dueSoonHours: number;
  excluded: string[]; stopped: boolean; review: ReviewDue | null;
  random: number; mainWeight: number;
}
export type PickResult = { kind: 'task'; card: Card; resetRound: boolean } | { kind: 'review'; review: ReviewDue; resetRound: boolean } |
  { kind: 'guide'; guide: GuideKind; resetRound: false } | { kind: 'stopped'; resetRound: false };

export function isCandidate(card: Card, projects: Project[]): boolean {
  return (card.status === '待做' || card.status === '进行中') && (card.project_id === null || projects.some(p => p.id === card.project_id && inBackpack(p)));
}
export function pick(input: PickInput): PickResult {
  if (input.stopped) return { kind: 'stopped', resetRound: false };
  const projects = input.projects.filter(inBackpack), mainIds = new Set(projects.filter(p => p.slot === '主线').map(p => p.id));
  const main = (card: Card) => card.project_id !== null && mainIds.has(card.project_id);
  const pool = input.cards.filter(card => isCandidate(card, projects));
  const reviewKey = input.review ? `review:${input.review.period}` : null;
  let candidates = pool.filter(card => !input.excluded.includes(card.id));
  let review = input.review && !input.excluded.includes(reviewKey!) ? input.review : null;
  const resetRound = candidates.length === 0 && !review && (pool.length > 0 || input.review !== null);
  if (resetRound) { candidates = pool; review = input.review; }
  const order = (a: Card, b: Card) => a.order - b.order || a.id.localeCompare(b.id);
  const due = (a: Card, b: Card) => (a.due_at === null ? Infinity : Date.parse(a.due_at)) - (b.due_at === null ? Infinity : Date.parse(b.due_at)) || order(a, b);
  const task = (cards: Card[], compare = order): PickResult | null => cards.length ? { kind: 'task', card: [...cards].sort(compare)[0], resetRound } : null;
  const blocked = task(candidates.filter(card => card.blocking), due);
  if (blocked) return blocked;
  if (review) return { kind: 'review', review, resetRound };
  const urgent = task(candidates.filter(card => card.due_at !== null && Date.parse(card.due_at) <= Date.parse(input.at) + input.dueSoonHours * 3600000), due);
  if (urgent) return urgent;
  const done = baseline(input.cards, input.day, mainIds.size > 0);
  if (done.main === false) { const selected = task(candidates.filter(main)); if (selected) return selected; }
  if (!done.side) { const selected = task(candidates.filter(card => !main(card))); if (selected) return selected; }
  if (candidates.length === 0) return { kind: 'guide', guide: guide(input.cards, input.projects), resetRound: false };
  if (!(input.random >= 0 && input.random < 1) || !(input.mainWeight > 0)) throw new Error('Invalid selection weights/random value');
  const sorted = [...candidates].sort(order), total = sorted.reduce((sum, card) => sum + (main(card) ? input.mainWeight : 1), 0);
  let remaining = input.random * total;
  for (const card of sorted) { remaining -= main(card) ? input.mainWeight : 1; if (remaining < 0) return { kind: 'task', card, resetRound }; }
  throw new Error('Weighted card selection failed');
}
