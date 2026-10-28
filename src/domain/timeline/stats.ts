import type { Segment } from './segment';
import { effective } from './effective';
import { splitAtDays } from './day';

export function cardMilliseconds(segments: Segment[], cardId: string, at: string): number {
  return effective(segments, at).filter(segment => segment.card_id === cardId)
    .reduce((total, segment) => total + Date.parse(segment.ended_at!) - Date.parse(segment.started_at), 0);
}
export function activityDayTotals(segments: Segment[], at: string, boundary: number): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const segment of effective(segments, at)) {
    for (const piece of splitAtDays(segment.started_at, segment.ended_at!, boundary)) {
      const day = result[piece.day] ??= {};
      day[segment.project] = (day[segment.project] ?? 0) + Date.parse(piece.end) - Date.parse(piece.start);
    }
  }
  return result;
}
