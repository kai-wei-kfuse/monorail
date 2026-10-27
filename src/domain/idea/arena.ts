import type { RecordEntry } from '../record/record';
import { activeIdeas, weakest, freezeIdea } from './pool';

export interface Duel { left: RecordEntry; right: RecordEntry }
export function pair(records: RecordEntry[], limit: number): Duel | null {
  const active = activeIdeas(records);
  if (active.length <= limit) return null;
  const left = [...active].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id))[0];
  const right = weakest(active.filter(record => record.id !== left.id));
  if (!right) throw new Error('对决需要两个活跃想法');
  return { left, right };
}
export function decide(winner: RecordEntry, loser: RecordEntry, at: string): [RecordEntry, RecordEntry] {
  if (winner.id === loser.id || [winner, loser].some(record => record.kind !== '想法' || record.pool !== '活跃池')) throw new Error('对决双方必须是不同的活跃想法');
  return [{ ...winner, last_touched_at: at }, { ...freezeIdea(loser, at), last_touched_at: at }];
}
