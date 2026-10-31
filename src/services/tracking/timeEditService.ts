import { applyReadout, editEntry, previewReadout, removeEntry } from '../../domain/timeline/edit';
import type { ReadoutPlan, ReadoutRequest } from '../../domain/timeline/edit';
import type { EntryTemplate, TimeEntry } from '../../domain/timeline/entry';
import { place } from '../../domain/timeline/place';
import type { TrackingTransaction } from './transaction';
import { acceptInTx } from './transaction';
import { parseClock, parseReadout } from '../../shared/duration';
import { addDays } from '../../shared/time';

function findEntry(tx: TrackingTransaction, id: string): TimeEntry {
  const entry = tx.entries.find(entry => entry.id === id);
  if (!entry) throw new Error('计时条目不存在');
  return entry;
}
export function updateRangeInTx(tx: TrackingTransaction, id: string, start: string, end: string | null): void {
  const entry = findEntry(tx, id);
  if ((end === null) !== (entry.ended_at === null)) throw new Error('不能改变条目的计时状态');
  editInTx(tx, id, entry.ended_at === null ? { started_at: start } : { started_at: start, ended_at: end });
}
export function moveInTx(tx: TrackingTransaction, id: string, start: string): void {
  const entry = findEntry(tx, id);
  if (entry.ended_at === null) throw new Error('正在计时的条目只能调整开始边');
  const end = new Date(Date.parse(start) + Date.parse(entry.ended_at) - Date.parse(entry.started_at)).toISOString();
  updateRangeInTx(tx, id, start, end);
}
export function copyInTx(tx: TrackingTransaction, id: string, start?: string): string {
  const entry = findEntry(tx, id);
  if (entry.ended_at === null) throw new Error('正在计时的条目不能复制');
  const length = Date.parse(entry.ended_at) - Date.parse(entry.started_at);
  const from = start === undefined ? (Date.parse(entry.ended_at) + length <= Date.parse(tx.at)
    ? Date.parse(entry.ended_at) : Date.parse(entry.started_at) - length) : Date.parse(start);
  return manualInTx(tx, entry, new Date(from).toISOString(), new Date(from + length).toISOString(), '日历').id;
}
export function patchMetadataInTx(tx: TrackingTransaction, id: string, patch: Partial<Pick<EntryTemplate, 'description' | 'project' | 'tags'>>): void {
  const entry = findEntry(tx, id);
  if (entry.card_id && (patch.description !== undefined || patch.project !== undefined)) throw new Error('来自卡的描述和项目请在卡上修改');
  editInTx(tx, id, patch);
}
function atClock(text: string, base: string): string {
  const endOfDay = new Date(base); endOfDay.setHours(23, 59, 59, 999);
  const parsed = parseClock(text, endOfDay.getTime());
  if (parsed === null || !Number.isFinite(parsed)) throw new Error('无法识别时刻，请输入 9:30');
  return new Date(parsed).toISOString();
}
export function setStartInTx(tx: TrackingTransaction, id: string, text: string): void {
  const entry = findEntry(tx, id);
  editInTx(tx, id, { started_at: atClock(text, entry.started_at) });
}
export function setEndInTx(tx: TrackingTransaction, id: string, text: string): void {
  const entry = findEntry(tx, id);
  if (entry.ended_at === null) throw new Error('正在计时的条目不能修改结束时间');
  let end = atClock(text, entry.started_at);
  if (Date.parse(end) <= Date.parse(entry.started_at)) end = new Date(addDays(Date.parse(end), 1)).toISOString();
  editInTx(tx, id, { ended_at: end });
}
export function setDurationInTx(tx: TrackingTransaction, id: string, text: string): void {
  const entry = findEntry(tx, id);
  if (entry.ended_at === null) throw new Error('正在计时的条目不能修改时长');
  const current = Date.parse(entry.ended_at) - Date.parse(entry.started_at);
  const length = parseReadout(text, 'mmss', current);
  if (length === null || !Number.isFinite(length) || length <= 0) throw new Error('无法识别正数时长，请输入 45:00、01:30:00 或 1h 30m');
  editInTx(tx, id, { ended_at: new Date(Date.parse(entry.started_at) + length).toISOString() });
}

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
