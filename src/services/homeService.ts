import type { Ctx, Transaction } from './commit';
import { run } from './commit';
import * as tracking from './tracking/api';
import type { ReadoutRequest, ReadoutPlan, EntryTemplate } from './tracking/api';
import { alignInTx, startCardInTx, editContentInTx, editMetaInTx } from './cardService';
import { drawInTx } from './dealService';

export interface Range { start: string; end: string }
function template(tx: Transaction, activity: string): EntryTemplate {
  const preset = tx.settings.lists.presets.find(preset => preset.id === activity);
  if (preset) return { description: preset.name, project: preset.project, tags: preset.tags, card_id: null };
  const description = activity.trim(); if (!description) throw new Error('活动名不能为空');
  return { description, project: description === '睡觉' ? '睡眠' : description === '离线' ? '离线' : '生活', tags: [], card_id: null };
}
function clearPending(tx: Transaction): void { tx.state.pending_id = null; tx.state.pending_at = null; }
const action = <T>(ctx: Ctx, at: string, work: (tx: Transaction) => Promise<T> | T) => run(ctx, async tx => {
  const result = await work(tx); alignInTx(tx); return result;
}, at);
export const beginPending = (ctx: Ctx, at: string) => action(ctx, at, tx => {
  if (tx.state.pending_id === null) { tx.state.pending_id = tx.id(); tx.state.pending_at = at; }
});
export const cancelPending = (ctx: Ctx, pendingId: string, at: string) => action(ctx, at, tx => {
  if (pendingId !== tx.state.pending_id) throw new Error('待确认会话已改变');
  clearPending(tx);
  if (tx.cards.find(card => card.id === tx.state.current_card)?.status === '待做') { tx.state.current_card = null; tx.state.home_mode = 'blank'; }
});
export const startFree = (ctx: Ctx, value: Omit<EntryTemplate, 'card_id'>, at: string) => action(ctx, at, tx => {
  const from = tx.state.pending_at ?? at; clearPending(tx);
  tracking.startInTx(tx, { ...value, card_id: null }, from);
  tx.state.current_card = null; tx.state.home_mode = 'blank';
});
export const startCard = (ctx: Ctx, cardId: string, at: string) => action(ctx, at, async tx => {
  const from = tx.state.pending_at ?? at; clearPending(tx); await startCardInTx(tx, cardId, from);
});
export const draw = (ctx: Ctx, at: string) => action(ctx, at, tx => {
  if (tx.state.pending_id === null) { tx.state.pending_id = tx.id(); tx.state.pending_at = at; }
  drawInTx(tx);
});
export const pause = (ctx: Ctx, at: string) => action(ctx, at, tx => tracking.pauseInTx(tx));
export const insert = (ctx: Ctx, activity: string, at: string) => action(ctx, at, tx => tracking.insertInTx(tx, template(tx, activity)));
export const resume = (ctx: Ctx, at: string) => action(ctx, at, async tx => {
  const target = tx.entries.find(entry => entry.id === tx.state.resume_entry_id);
  const card = tx.cards.find(card => card.id === target?.card_id);
  if (card && (card.status === '待做' || card.status === '进行中')) {
    tx.state.resume_entry_id = null; await startCardInTx(tx, card.id);
  } else tracking.resumeInTx(tx, target ? { ...target, card_id: null } : undefined);
});
export const sleep = (ctx: Ctx, at: string) => action(ctx, at, tx => { clearPending(tx); tracking.startSystemInTx(tx, '睡眠'); tx.state.resume_entry_id = null; });
export const wake = (ctx: Ctx, at: string) => action(ctx, at, tx => tracking.startSystemInTx(tx, '待机'));
export const backfillRange = (ctx: Ctx, range: Range, activity: string, at: string) => action(ctx, at, tx => tracking.manualInTx(tx, template(tx, activity), range.start, range.end));
export const backfillSwitch = (ctx: Ctx, minutes: number, activity: string, at: string) => action(ctx, at, tx => {
  if (!(minutes > 0)) throw new Error('补记分钟数必须为正数');
  tracking.insertInTx(tx, template(tx, activity));
  const result = tracking.setReadoutInTx(tx, { entryId: tx.state.open_entry!, at, mode: 'entry', milliseconds: minutes * 60000 }, null);
  // The v1 dialog cannot return a preview token. Roll back instead of committing a half-applied correction.
  if (result.kind === 'confirm') throw new Error('会覆盖已有记录，请使用计时条读数预览并确认');
  return result;
});
export async function settleOfflineInTx(tx: Transaction, gap: Range) {
  if (Date.parse(gap.end) - Date.parse(gap.start) < tx.settings.offlineAskMinMinutes * 60000) return null;
  if (tx.entries.some(entry => entry.source === '离线追问' && Date.parse(entry.started_at) === Date.parse(gap.start))) return null;
  const entry = tracking.settleOfflineInTx(tx, gap); alignInTx(tx);
  tx.notices.push({ id: tx.id(), kind: 'offlineAsk', data: { from: gap.start, to: gap.end, activities: tx.settings.lists.presets.map(item => ({ id: item.id, name: item.name })) } });
  return entry;
}
export const settleOffline = (ctx: Ctx, gap: Range) => action(ctx, gap.end, tx => settleOfflineInTx(tx, gap));
export const answerOffline = (ctx: Ctx, gap: Range, activity: string, at: string) => action(ctx, at, tx => {
  const entry = tx.entries.find(entry => entry.source === '离线追问' && entry.started_at === gap.start && entry.ended_at === gap.end);
  if (!entry) throw new Error('离线条目不存在');
  const value = template(tx, activity); tracking.editInTx(tx, entry.id, value);
});
export const setReadout = (ctx: Ctx, request: ReadoutRequest, seen: ReadoutPlan | null) => action(ctx, request.at, tx => tracking.setReadoutInTx(tx, request, seen));
export const continueEntry = (ctx: Ctx, entryId: string, at: string) => action(ctx, at, async tx => {
  const entry = tx.entries.find(entry => entry.id === entryId); if (!entry) throw new Error('计时条目不存在');
  const card = tx.cards.find(card => card.id === entry.card_id), from = tx.state.pending_at ?? at; clearPending(tx);
  if (card && (card.status === '待做' || card.status === '进行中')) await startCardInTx(tx, card.id, from);
  else tracking.startInTx(tx, { ...entry, card_id: null }, from);
});
export const editMeta = (ctx: Ctx, cardId: string, project: string | null, tags: string[], at: string) => action(ctx, at, tx => {
  editMetaInTx(tx, cardId, project, tags);
});
export const editOpen = (ctx: Ctx, entryId: string, patch: Partial<Pick<EntryTemplate, 'description' | 'project' | 'tags'>>, at: string) => action(ctx, at, tx => {
  const open = tracking.openInTx(tx); if (!open || open.id !== entryId) throw new Error('已经换成别的事了');
  if (!open.card_id) { tracking.editInTx(tx, entryId, patch); return; }
  const card = tx.cards.find(card => card.id === open.card_id)!;
  if (patch.description !== undefined) editContentInTx(tx, card.id, patch.description);
  if (patch.project !== undefined || patch.tags !== undefined) editMetaInTx(tx, card.id, patch.project ?? card.project, patch.tags ?? card.tags);
});
export interface HomeReadoutRequest { target: { mode: 'pending' | 'entry' | 'ref'; id: string }; milliseconds: number; at: string }
export const commitReadout = (ctx: Ctx, request: HomeReadoutRequest, seen: ReadoutPlan | null) => action(ctx, request.at, tx => {
  if (request.target.mode === 'pending') {
    if (request.target.id !== tx.state.pending_id) throw new Error('待确认会话已改变');
    if (!Number.isFinite(request.milliseconds) || request.milliseconds < 0) throw new Error('读数不能小于 0');
    tx.state.pending_at = new Date(Date.parse(request.at) - request.milliseconds).toISOString();
    return { kind: 'done' as const, hit: [] };
  }
  const open = tracking.openInTx(tx);
  if (!open || (request.target.mode === 'ref' ? open.card_id : open.id) !== request.target.id) throw new Error('已经换成别的事了');
  const result = tracking.setReadoutInTx(tx, { entryId: open.id, mode: request.target.mode, at: request.at, milliseconds: request.milliseconds }, seen);
  return result.kind === 'confirm' ? { kind: 'confirm' as const, plan: result.plan, hit: result.plan.hit } : { kind: 'done' as const, hit: result.plan.hit };
});
