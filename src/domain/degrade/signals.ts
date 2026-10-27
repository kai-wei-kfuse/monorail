import type { Card } from '../card/card';

export function skipCard(card: Card, threshold: number): { card: Card; signal: boolean } {
  const count = card.skip_count + 1;
  return { card: { ...card, skip_count: count }, signal: count === threshold };
}
export function restAnswer(counts: Record<string, number>, answer: string, threshold: number) {
  const key = answer.trim();
  if (!key) return { counts: { ...counts }, signal: false };
  const count = (counts[key] ?? 0) + 1;
  return { counts: { ...counts, [key]: count }, signal: count === threshold };
}
