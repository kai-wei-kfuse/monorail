import type { TimeEntry } from '../../domain/timeline/entry';
import { activityDay } from '../../domain/timeline/day';

export interface TrackingState { open_entry: string | null; open_entry_day: string | null; resume_entry_id: string | null }
export interface TrackingTransaction {
  readonly scope: 'transaction'; readonly at: string; readonly id: () => string; readonly now: () => string;
  readonly settings: { dayBoundaryHour: number };
  entries: TimeEntry[]; state: TrackingState;
}
export const openInTx = (tx: TrackingTransaction) => tx.entries.find(entry => entry.id === tx.state.open_entry) ?? null;
export function acceptInTx(tx: TrackingTransaction, entries: TimeEntry[]): void {
  tx.entries = entries;
  const open = entries.find(entry => entry.ended_at === null);
  tx.state.open_entry = open?.id ?? null;
  tx.state.open_entry_day = open ? activityDay(open.started_at, tx.settings.dayBoundaryHour) : null;
  if (tx.state.resume_entry_id && !entries.some(entry => entry.id === tx.state.resume_entry_id)) tx.state.resume_entry_id = null;
}
