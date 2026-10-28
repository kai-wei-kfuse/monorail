import { applyReadout, editEntry, previewReadout, removeEntry } from '../../domain/timeline/edit';
import type { ReadoutPlan, ReadoutRequest } from '../../domain/timeline/edit';
import type { EntryTemplate, TimeEntry } from '../../domain/timeline/entry';
import { place } from '../../domain/timeline/place';
import type { TrackingTransaction } from './transaction';
import { acceptInTx } from './transaction';

export const previewReadoutInTx = (tx: TrackingTransaction, request: ReadoutRequest) => previewReadout(tx.entries, request);
export function setReadoutInTx(tx: TrackingTransaction, request: ReadoutRequest, seen: ReadoutPlan | null) {
  const result = applyReadout(tx.entries, request, seen, tx.now(), tx.id);
  if (result.kind === 'done') acceptInTx(tx, result.entries);
  return result;
}
export function setRefTotalInTx(tx: TrackingTransaction, ref: string, milliseconds: number, seen: ReadoutPlan | null) {
  const open = tx.entries.find(entry => entry.id === tx.state.open_entry);
  if (!open || open.card_id !== ref) throw new Error('当前计时引用已改变');
  return setReadoutInTx(tx, { entryId: open.id, at: tx.at, milliseconds, mode: 'ref' }, seen);
}
export function manualInTx(tx: TrackingTransaction, template: EntryTemplate, start: string, end: string, source: TimeEntry['source'] = '手动'): TimeEntry {
  if (!(Date.parse(end) > Date.parse(start))) throw new Error('结束时间必须晚于开始时间');
  if (Date.parse(end) > Date.parse(tx.at)) throw new Error('结束时间不能晚于现在');
  const entry: TimeEntry = { ...template, id: tx.id(), started_at: start, ended_at: end, source, kind: '普通', updated_at: tx.at };
  acceptInTx(tx, place(tx.entries, entry, 'overlay', tx.now(), tx.id));
  return entry;
}
export function editInTx(tx: TrackingTransaction, id: string, patch: Parameters<typeof editEntry>[2]): void {
  acceptInTx(tx, editEntry(tx.entries, id, patch, tx.at, tx.id));
}
export function deleteInTx(tx: TrackingTransaction, id: string): void { acceptInTx(tx, removeEntry(tx.entries, id, tx.at)); }
