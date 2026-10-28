import type { EntryTemplate, TimeEntry } from '../../domain/timeline/entry';
import { isIdle } from '../../domain/timeline/entry';
import { claim, place } from '../../domain/timeline/place';
import { editEntry } from '../../domain/timeline/edit';
import type { TrackingTransaction } from './transaction';
import { acceptInTx, openInTx } from './transaction';

export function startInTx(tx: TrackingTransaction, template: EntryTemplate, from = tx.at, kind: TimeEntry['kind'] = '普通', source: TimeEntry['source'] = '计时'): TimeEntry {
  const current = openInTx(tx);
  if (current && Date.parse(current.started_at) > Date.parse(tx.at)) throw new Error('命令时间早于当前计时');
  const start = claim(tx.entries, from, tx.at);
  const closed = tx.entries.flatMap(entry => entry.id === current?.id
    ? Date.parse(entry.started_at) === Date.parse(tx.at) ? [] : [{ ...entry, ended_at: tx.at, updated_at: tx.at }]
    : [entry]);
  const entry: TimeEntry = { ...template, tags: [...template.tags], id: tx.id(), started_at: start, ended_at: null, kind, source, updated_at: tx.at };
  if (kind === '普通') tx.state.resume_entry_id = null;
  acceptInTx(tx, place(closed, entry, 'switch', tx.now(), tx.id));
  return entry;
}
export function startSystemInTx(tx: TrackingTransaction, project: string, kind: TimeEntry['kind'] = '普通'): TimeEntry {
  const description = project === '待机' ? tx.settings.lists.idleName : project === '睡眠' ? '睡觉' : project === '回顾' ? '每周回顾' : project;
  return startInTx(tx, { description, project, tags: [], card_id: null }, tx.at, kind, '自动');
}
export function pauseInTx(tx: TrackingTransaction): void {
  const entry = openInTx(tx);
  if (!entry || isIdle(entry)) return;
  if (entry.kind === '普通') tx.state.resume_entry_id = entry.id;
  startSystemInTx(tx, '待机', '暂停');
}
export function insertInTx(tx: TrackingTransaction, template: EntryTemplate): void {
  const entry = openInTx(tx);
  if (entry?.kind === '普通') tx.state.resume_entry_id = isIdle(entry) ? null : entry.id;
  startInTx(tx, template, tx.at, '插入');
}
export function resumeInTx(tx: TrackingTransaction, template?: EntryTemplate): void {
  const entry = tx.entries.find(value => value.id === tx.state.resume_entry_id);
  tx.state.resume_entry_id = null;
  if (!entry) { startSystemInTx(tx, '待机'); return; }
  startInTx(tx, template ?? entry);
}
export function stopRefInTx(tx: TrackingTransaction, ref: string): void {
  const open = openInTx(tx), resume = tx.entries.find(entry => entry.id === tx.state.resume_entry_id);
  if (resume?.card_id === ref) tx.state.resume_entry_id = null;
  if (open?.card_id === ref || (resume?.card_id === ref && open?.kind !== '普通')) startSystemInTx(tx, '待机');
}
export function retagRefInTx(tx: TrackingTransaction, ref: string, project: string, tags: string[]): void {
  const open = openInTx(tx);
  if (open?.card_id === ref) acceptInTx(tx, editEntry(tx.entries, open.id, { project, tags: [...tags] }, tx.at, tx.id));
}
export function renameRefInTx(tx: TrackingTransaction, ref: string, description: string): void {
  const open = openInTx(tx);
  if (open?.card_id === ref) acceptInTx(tx, editEntry(tx.entries, open.id, { description }, tx.at, tx.id));
}
export function settleOfflineInTx(tx: TrackingTransaction, gap: { start: string; end: string }): TimeEntry {
  const current = openInTx(tx);
  if (current && Date.parse(current.started_at) <= Date.parse(gap.end)) {
    const atGap = { ...tx, at: gap.end };
    startSystemInTx(atGap, '待机');
    tx.entries = atGap.entries; tx.state.resume_entry_id = null;
  }
  const entry: TimeEntry = { id: tx.id(), started_at: gap.start, ended_at: gap.end, description: '离线', project: '离线',
    tags: [], card_id: null, kind: '普通', source: '离线追问', updated_at: tx.at };
  acceptInTx(tx, place(tx.entries, entry, 'switch', tx.now(), tx.id));
  return entry;
}
