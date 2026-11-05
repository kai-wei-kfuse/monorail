import type { EntryTemplate, TimeEntry } from '../../domain/timeline/entry';
import { isIdle } from '../../domain/timeline/entry';
import { claim, place } from '../../domain/timeline/place';
import { editEntry } from '../../domain/timeline/edit';
import { insertState, insertToContinue } from '../../domain/timeline/insert';
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
/** 插入状态（ADR 0021 第 3 条）：以回到目标不为空为前提。 */
export function insertStateInTx(tx: TrackingTransaction) {
  const resume = tx.state.resume_entry_id ? tx.entries.find(e => e.id === tx.state.resume_entry_id) : undefined;
  return insertState(openInTx(tx), resume);
}
export function pauseInTx(tx: TrackingTransaction): void {
  const state = insertStateInTx(tx);
  if (state === 'inserting') { pauseInsertInTx(tx); return; }
  if (state === 'insertPaused') return;
  const entry = openInTx(tx);
  if (!entry || isIdle(entry)) return;
  if (entry.kind === '普通') tx.state.resume_entry_id = entry.id;
  startSystemInTx(tx, '待机', '暂停');
}
// 停止：截断正在计的这一条（或清除已暂停会话），转为待机，不留回到目标（和暂停不同，之后没有〔继续〕）
export function stopInTx(tx: TrackingTransaction): void {
  if (insertStateInTx(tx)) throw new Error('IN_AWAY_ACTIVITY：正在插入别的事，先回到任务或结束原任务');
  const entry = openInTx(tx);
  if (!entry || (isIdle(entry) && entry.kind === '普通' && tx.state.resume_entry_id === null)) return;
  tx.state.resume_entry_id = null;
  startSystemInTx(tx, '待机');
}
export function insertInTx(tx: TrackingTransaction, template: EntryTemplate, from = tx.at): void {
  const entry = openInTx(tx);
  if (entry?.kind === '普通') tx.state.resume_entry_id = isIdle(entry) ? null : entry.id;
  startInTx(tx, template, from, '插入');
}
/** 插入的事暂停（已定 56）：开「待机 / 插入」，回到目标不动。刚开始的同一毫秒内不做（startInTx 会删掉而不是截断）。 */
export function pauseInsertInTx(tx: TrackingTransaction): void {
  const entry = openInTx(tx);
  if (!entry || insertStateInTx(tx) !== 'inserting' || Date.parse(entry.started_at) === Date.parse(tx.at)) return;
  startSystemInTx(tx, '待机', '插入');
}
/** 插入的事继续：照前一段插入再开一段（同 Toggl 的继续）。找不到前一段抛错。 */
export function continueInsertInTx(tx: TrackingTransaction): void {
  const open = openInTx(tx), resume = tx.entries.find(e => e.id === tx.state.resume_entry_id);
  if (!open || !resume || insertStateInTx(tx) !== 'insertPaused') throw new Error('现在没有暂停的插入');
  const previous = insertToContinue(tx.entries, open, resume);
  if (!previous) throw new Error('找不到刚才插入的那件事，可以回到任务或开始别的事');
  startInTx(tx, { description: previous.description, project: previous.project, tags: [...previous.tags], card_id: null }, tx.at, '插入');
}
/** 前一段能不能继续（投影用，界面据此灰掉〔继续〕）。 */
export function canContinueInsert(entries: readonly TimeEntry[], open: TimeEntry | undefined, resume: TimeEntry | undefined): boolean {
  return !!open && !!resume && insertState(open, resume) === 'insertPaused' && insertToContinue(entries, open, resume) !== null;
}
/**
 * 改开着那一条的类型（ADR 0021 第 3、13 条共用）：结束原任务时插入条目变普通、清回到目标；
 * 空闲追问的回答也用它改 kind。经 editEntry 走 place。
 */
export function retypeEntryInTx(tx: TrackingTransaction, id: string, patch: Partial<Pick<TimeEntry, 'kind' | 'description' | 'project' | 'tags'>>): void {
  acceptInTx(tx, editEntry(tx.entries, id, patch, tx.at, tx.id));
}
/** 结束原任务（已定 19、26）：插入条目变成普通的自由记录，接着计；回到目标清掉，原来那张卡由 align 放回待做。 */
export function promoteInsertInTx(tx: TrackingTransaction): void {
  const open = openInTx(tx);
  if (!open || !insertStateInTx(tx)) throw new Error('现在没有在插入别的事');
  tx.state.resume_entry_id = null;
  retypeEntryInTx(tx, open.id, { kind: '普通' });
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
export function settleOfflineInTx(tx: TrackingTransaction, gap: { start: string; end: string }, loose = false): TimeEntry {
  const current = openInTx(tx);
  if (current && Date.parse(current.started_at) <= Date.parse(gap.end)) {
    const atGap = { ...tx, at: gap.end };
    startSystemInTx(atGap, '待机');
    tx.entries = atGap.entries; tx.state.resume_entry_id = null;
  }
  const entry: TimeEntry = { id: tx.id(), started_at: gap.start, ended_at: gap.end,
    ...(loose ? { description: tx.settings.lists.idleName, project: '待机' } : { description: '离线', project: '离线' }),
    tags: [], card_id: null, kind: '普通', source: '离线追问', updated_at: tx.at };
  acceptInTx(tx, place(tx.entries, entry, 'switch', tx.now(), tx.id));
  return entry;
}
