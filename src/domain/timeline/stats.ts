import type { TimeEntry } from './entry';
import { splitAtDays } from './day';

export function cardMilliseconds(entries: TimeEntry[], cardId: string, at: string): number {
  return entries.filter(entry => entry.card_id === cardId)
    .reduce((total, entry) => total + Date.parse(entry.ended_at ?? at) - Date.parse(entry.started_at), 0);
}
export function activityDayTotals(entries: TimeEntry[], at: string, boundary: number): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const entry of entries) {
    for (const piece of splitAtDays(entry.started_at, entry.ended_at ?? at, boundary)) {
      const day = result[piece.day] ??= {};
      day[entry.project] = (day[entry.project] ?? 0) + Date.parse(piece.end) - Date.parse(piece.start);
    }
  }
  return result;
}
