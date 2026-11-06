import type { Ctx, Transaction } from './commit';
import { activityDay, activityDayStartOf } from '../domain/timeline/day';
import { askChoices } from '../shared/notices';
import { run } from './commit';
import type { HistoryIntent, HistorySource } from '../shared/history';
import * as tracking from './tracking/api';
import { entryAction } from '../domain/timeline/insert';
import type { EntrySource } from '../domain/timeline/insert';
import type { ReadoutRequest, ReadoutPlan, EntryTemplate, TimeEntry } from './tracking/api';
import { alignInTx, startCardInTx, editContentInTx, editMetaInTx } from './cardService';
import type { MiniCommand, MiniOutcome } from '../platform/windowBus';
import { validateUserProject, validateUserTags } from '../domain/timeline/project';
import type { AppState } from '../data/repos';
import type { Card } from '../domain/card/card';

export function timerStateToken(state: AppState, openEntry: TimeEntry | null, currentCard: Pick<Card, 'id' | 'status'> | null): string {
  return `ts1:${[
    openEntry?.id ?? '-', openEntry?.started_at ?? '-', openEntry?.kind ?? '-', openEntry?.project ?? '-',
    openEntry?.card_id ?? '-', state.current_card ?? '-', currentCard?.status ?? '-',
    state.pending_id ?? '-', state.pending_at ?? '-', state.resume_entry_id ?? '-', state.rest?.started_at ?? '-',
  ].join('|')}`;
}
export function timerStateTokenInTx(tx: Pick<Transaction, 'state' | 'entries' | 'cards'>): string {
  const open = tx.entries.find(entry => entry.id === tx.state.open_entry) ?? null;
  const card = tx.cards.find(item => item.id === tx.state.current_card) ?? null;
  return timerStateToken(tx.state, open, card);
}

export interface Range { start: string; end: string }
export const manual = (ctx: Ctx, value: Omit<EntryTemplate, 'card_id'>, start: string, end: string, at: string) =>
  action(ctx, at, tx => tracking.manualInTx(tx, { ...value, card_id: null }, start, end).id, { action: 'home.manual' });
export const overlaps = (ctx: Ctx, start: string, end: string, at = ctx.now()) =>
  tracking.overlaps(ctx.repos.times.snapshot(), start, end, at);
export function startPresetInTx(tx: Transaction, presetId: string): void {
  const preset = tx.settings.lists.presets.find(item => item.id === presetId);
  if (!preset) throw new Error('预设不存在');
  // 快捷活动（弹层）永远插入；收藏（计时条）做卡时插入、自由计时时切换（已定 21、22、25）。0.3.1 不读 mode
  startOtherInTx(tx, { description: preset.name, project: preset.project, tags: preset.tags }, preset.place === '弹层' ? 'quick' : 'favorite');
}
/**
 * 开始别的事的统一入口（ADR 0021 第 3 条入口表，第 2 轮 B3）：做卡时插入、插入中替换、自由计时时按来源插入或切换。
 * 起点都取待确认起点（往前拨过的起点不丢），并清掉待确认。
 */
export function startOtherInTx(tx: Transaction, value: Omit<EntryTemplate, 'card_id'>, source: EntrySource): void {
  const resume = tx.state.resume_entry_id ? tx.entries.find(e => e.id === tx.state.resume_entry_id) : undefined;
  const decision = entryAction(tracking.openInTx(tx), resume, source);
  const from = tx.state.pending_at ?? tx.at; clearPending(tx);
  if (decision === 'insert' || decision === 'replace') { tracking.insertInTx(tx, { ...value, card_id: null }, from); return; }
  tracking.startInTx(tx, { ...value, card_id: null }, from);
  tx.state.current_card = null; tx.state.home_mode = 'blank';
}
export const startPreset = (ctx: Ctx, presetId: string, at: string) => action(ctx, at, tx => startPresetInTx(tx, presetId), { action: 'home.startPreset' });
function template(tx: Transaction, activity: string): EntryTemplate {
  const preset = tx.settings.lists.presets.find(preset => preset.id === activity);
  if (preset) return { description: preset.name, project: preset.project, tags: preset.tags, card_id: null };
  const description = activity.trim(); if (!description) throw new Error('活动名不能为空');
  return { description, project: description === '睡觉' ? '睡眠' : description === '离线' ? '离线' : '生活', tags: [], card_id: null };
}
function clearPending(tx: Transaction): void { tx.state.pending_id = null; tx.state.pending_at = null; }
const action = <T>(ctx: Ctx, at: string, work: (tx: Transaction) => Promise<T> | T, intent: HistoryIntent) => run(ctx, async tx => {
  const result = await work(tx); alignInTx(tx); return result;
}, at, intent);
export function beginPendingInTx(tx: Transaction): void {
  if (tx.state.pending_id === null) { tx.state.pending_id = tx.id(); tx.state.pending_at = tx.at; }
}
export const beginPending = (ctx: Ctx, at: string) => action(ctx, at, beginPendingInTx, { action: 'home.beginPending' });
export function cancelPendingInTx(tx: Transaction, pendingId: string): void {
  if (pendingId !== tx.state.pending_id) throw new Error('待确认会话已改变');
  clearPending(tx);
  if (tx.cards.find(card => card.id === tx.state.current_card)?.status === '待做') { tx.state.current_card = null; tx.state.home_mode = 'blank'; }
}
export const cancelPending = (ctx: Ctx, pendingId: string, at: string) => action(ctx, at, tx => cancelPendingInTx(tx, pendingId), { action: 'home.cancelPending' });
export function startFreeInTx(tx: Transaction, value: Omit<EntryTemplate, 'card_id'>, source: EntrySource = 'timerBox'): void {
  startOtherInTx(tx, value, source);
}
export const startFree = (ctx: Ctx, value: Omit<EntryTemplate, 'card_id'>, at: string) => action(ctx, at, tx => startFreeInTx(tx, value), { action: 'home.startFree' });
/** 开始一张卡，起点用待确认的起点（主窗口自动完成、背包〔开始〕、小窗自动完成共用）。 */
async function startCardFromPendingInTx(tx: Transaction, cardId: string): Promise<void> {
  const from = tx.state.pending_at ?? tx.at; clearPending(tx); await startCardInTx(tx, cardId, from);
}
export const startCard = (ctx: Ctx, cardId: string, at: string) => action(ctx, at, async tx => {
  await startCardFromPendingInTx(tx, cardId);
}, { action: 'home.startCard' });
export const pause = (ctx: Ctx, at: string) => action(ctx, at, tx => tracking.pauseInTx(tx), { action: 'home.pause' });
// 停止计的是卡时，卡跟着 align 放回去
export const stop = (ctx: Ctx, at: string) => action(ctx, at, tx => tracking.stopInTx(tx), { action: 'home.stop' });
export const insert = (ctx: Ctx, activity: string, at: string, project?: string) => action(ctx, at, tx => {
  const preset = tx.settings.lists.presets.find(p => p.id === activity);
  // 快捷活动、收藏用它自己的项目；手写的临时活动用选的项目，没选记「未分类」（已定 62）
  const value = preset ? template(tx, activity) : answerTemplate(tx, activity, project);
  startOtherInTx(tx, value, preset?.place === '计时条' ? 'favorite' : preset ? 'quick' : 'temp');
}, { action: 'home.insert' });
export async function resumeInTx(tx: Transaction): Promise<void> {
  const target = tx.entries.find(entry => entry.id === tx.state.resume_entry_id);
  const card = tx.cards.find(card => card.id === target?.card_id);
  if (card && (card.status === '待做' || card.status === '进行中')) {
    tx.state.resume_entry_id = null; await startCardInTx(tx, card.id);
  } else tracking.resumeInTx(tx, target ? { ...target, card_id: null } : undefined);
}
export const resume = (ctx: Ctx, at: string) => action(ctx, at, resumeInTx, { action: 'home.resume' });
/** 〔继续〕（第 3 轮 B1）：插入的事暂停时继续插入的事；否则同现有的继续（卡暂停、自由记录暂停）。 */
export async function continueInTx(tx: Transaction): Promise<void> {
  if (tracking.insertStateInTx(tx) === 'insertPaused') { tracking.continueInsertInTx(tx); return; }
  await resumeInTx(tx);
}
export const continueTimer = (ctx: Ctx, at: string) => action(ctx, at, continueInTx, { action: 'home.continueInsert' });
/** 结束原任务（已定 19、26）：插入的事变成普通自由记录接着计；原来那张卡回待做，仍在今天的板子上。 */
export function endOriginalInTx(tx: Transaction): void { tracking.promoteInsertInTx(tx); }
export const endOriginal = (ctx: Ctx, at: string) => action(ctx, at, tx => {
  const resume = tx.entries.find(e => e.id === tx.state.resume_entry_id);
  endOriginalInTx(tx);
  return resume?.card_id ?? null;
}, { action: 'home.endOriginal' });
/** 主动休息（已定 48、55）：等同快捷活动插入一条「休息」；回来就是〔回到任务〕，不问、不计数。 */
/** 〔休息一下〕（已定 55、63）：插入一条「休息」，原来那张卡等你回来。项目缺省系统项目「休息」，用户可以换成别的用户项目。 */
export function restInTx(tx: Transaction, project?: string): void {
  const name = project === undefined || project === '休息' ? '休息' : validateUserProject(tx.settings.lists.projects, project);
  startOtherInTx(tx, { description: '休息', project: name, tags: [] }, 'quick');
}
export const rest = (ctx: Ctx, at: string, project?: string) => action(ctx, at, tx => restInTx(tx, project), { action: 'home.rest' });
export const sleep = (ctx: Ctx, at: string) => action(ctx, at, tx => { clearPending(tx); tracking.startSystemInTx(tx, '睡眠'); tx.state.resume_entry_id = null; }, { action: 'home.sleep' });
export const wake = (ctx: Ctx, at: string) => action(ctx, at, tx => tracking.startSystemInTx(tx, '待机'), { action: 'home.wake' });
export const backfillRange = (ctx: Ctx, range: Range, activity: string, at: string) => action(ctx, at, tx => tracking.manualInTx(tx, template(tx, activity), range.start, range.end), { action: 'home.backfillRange' });
export const backfillSwitch = (ctx: Ctx, minutes: number, activity: string, at: string) => action(ctx, at, tx => {
  if (!(minutes > 0)) throw new Error('补记分钟数必须为正数');
  tracking.insertInTx(tx, template(tx, activity));
  const result = tracking.setReadoutInTx(tx, { entryId: tx.state.open_entry!, at, mode: 'entry', milliseconds: minutes * 60000 }, null);
  // The v1 dialog cannot return a preview token. Roll back instead of committing a half-applied correction.
  if (result.kind === 'confirm') throw new Error('会覆盖已有记录，请使用计时条读数预览并确认');
  return result;
}, { action: 'home.backfillSwitch' });
export async function settleOfflineInTx(tx: Transaction, gap: Range) {
  if (Date.parse(gap.end) - Date.parse(gap.start) < tx.settings.offlineAskMinMinutes * 60000) return null;
  if (tx.entries.some(entry => entry.source === '离线追问' && Date.parse(entry.started_at) === Date.parse(gap.start))) return null;
  const loose = tx.settings.trackingMode === 'loose';
  const entry = tracking.settleOfflineInTx(tx, gap, loose); alignInTx(tx);
  if (!loose) tx.notices.push({ id: tx.id(), kind: 'offlineAsk', data: { from: gap.start, to: gap.end, ...askChoices(tx.settings) } });
  return entry;
}
export const settleOffline = (ctx: Ctx, gap: Range) => action(ctx, gap.end, tx => settleOfflineInTx(tx, gap), { action: 'system.resume', source: { kind: 'system', trigger: 'resume' } });
/** 回答空闲追问（ADR 0021 第 13 条，第 3 轮 S1）：那段待机改成这项活动，并改掉 kind，不留下「学习 / 暂停」这种条目。 */
/** 追问的回答（离线、空闲）：项目用用户选的；没选时快捷活动用它自己的项目，手写的记「未分类」（用户 2026-11-06）。 */
function answerTemplate(tx: Transaction, activity: string, project?: string): EntryTemplate {
  const value = template(tx, activity);
  if (value.project === '睡眠' || value.project === '离线') return value;
  const preset = tx.settings.lists.presets.find(p => p.id === activity);
  return { ...value, project: project !== undefined ? validateUserProject(tx.settings.lists.projects, project) : preset ? value.project : '未分类' };
}
export const answerIdle = (ctx: Ctx, entryId: string, activity: string, at: string, project?: string) => action(ctx, at, tx => {
  const entry = tx.entries.find(e => e.id === entryId);
  if (!entry || entry.project !== '待机' || entry.ended_at === null) throw new Error('那一段已经改过了');
  const value = answerTemplate(tx, activity, project);
  tracking.retypeEntryInTx(tx, entryId, { description: value.description, project: value.project, tags: value.tags, kind: entry.kind === '插入' ? '插入' : '普通' });
}, { action: 'home.answerIdle' });
export const answerOffline = (ctx: Ctx, gap: Range, activity: string, at: string, project?: string) => action(ctx, at, tx => {
  const entry = tx.entries.find(entry => entry.source === '离线追问' && entry.started_at === gap.start && entry.ended_at === gap.end);
  if (!entry) throw new Error('离线条目不存在');
  const value = answerTemplate(tx, activity, project); tracking.editInTx(tx, entry.id, value);
}, { action: 'home.answerOffline' });
export const setReadout = (ctx: Ctx, request: ReadoutRequest, seen: ReadoutPlan | null) => action(ctx, request.at, tx => tracking.setReadoutInTx(tx, request, seen), { action: 'home.setReadout' });
/** 日历和列表也会调用：source 记页面（缺省记首页）。 */
export async function continueEntryInTx(tx: Transaction, entryId: string): Promise<void> {
  const entry = tx.entries.find(entry => entry.id === entryId); if (!entry) throw new Error('计时条目不存在');
  const card = tx.cards.find(card => card.id === entry.card_id);
  if (card && (card.status === '待做' || card.status === '进行中')) {
    const resume = tx.entries.find(e => e.id === tx.state.resume_entry_id);
    // 插入中、或卡暂停中，继续的正是回到目标那张卡 = 〔回到任务〕/〔继续〕（代码审核 S5）
    const open = tracking.openInTx(tx);
    if (resume?.card_id === card.id && (tracking.insertStateInTx(tx) || open?.kind === '暂停')) { clearPending(tx); await resumeInTx(tx); return; }
    await startCardFromPendingInTx(tx, card.id);
    return;
  }
  startOtherInTx(tx, { description: entry.description, project: entry.project, tags: entry.tags }, 'continue');
}
export const continueEntry = (ctx: Ctx, entryId: string, at: string, source?: HistorySource) => action(ctx, at, tx => continueEntryInTx(tx, entryId),
  { action: 'home.continueEntry', ...(source ? { source } : {}) });
export const editMeta = (ctx: Ctx, cardId: string, project: string | null, tags: string[], at: string) => action(ctx, at, tx => {
  editMetaInTx(tx, cardId, project, tags);
}, { action: 'home.editMeta' });
export function editOpenInTx(tx: Transaction, entryId: string, patch: Partial<Pick<EntryTemplate, 'description' | 'project' | 'tags'>>): void {
  const open = tracking.openInTx(tx); if (!open || open.id !== entryId) throw new Error('已经换成别的事了');
  if (!open.card_id) { tracking.editInTx(tx, entryId, patch); return; }
  const card = tx.cards.find(card => card.id === open.card_id)!;
  if (patch.description !== undefined) editContentInTx(tx, card.id, patch.description);
  if (patch.project !== undefined || patch.tags !== undefined) editMetaInTx(tx, card.id, patch.project ?? card.project, patch.tags ?? card.tags);
}
export const editOpen = (ctx: Ctx, entryId: string, patch: Partial<Pick<EntryTemplate, 'description' | 'project' | 'tags'>>, at: string) => action(ctx, at, tx => editOpenInTx(tx, entryId, patch), { action: 'home.editOpen' });
export interface HomeReadoutRequest { target: { mode: 'idle' | 'pending' | 'entry' | 'ref' | 'refToday'; id: string }; milliseconds: number; at: string }
export function commitReadoutInTx(tx: Transaction, request: HomeReadoutRequest, seen: ReadoutPlan | null) {
  if (request.target.mode === 'idle' || request.target.mode === 'pending') {
    const open = tracking.openInTx(tx);
    if (request.target.mode === 'idle') {
      if (tx.state.pending_id || !open || open.project !== '待机' || open.id !== request.target.id) throw new Error('已经换成别的事了');
    } else if (request.target.id !== tx.state.pending_id) {
      throw new Error('待确认会话已改变');
    }
    const at = Date.parse(request.at);
    if (!Number.isFinite(at)) throw new Error('命令时间早于当前计时');
    if (!Number.isFinite(request.milliseconds) || request.milliseconds < 0) throw new Error('读数不能小于 0');
    const start = new Date(at - request.milliseconds).toISOString();
    const hit = request.milliseconds > 0
      ? tracking.overlaps(tx.entries, start, request.at, request.at).filter(entry => entry.id !== open?.id)
      : [];
    const plan: ReadoutPlan = { entryId: open?.id ?? request.target.id, start, hit };
    if (hit.length && JSON.stringify(plan) !== JSON.stringify(seen)) return { kind: 'confirm' as const, plan, hit };
    if (request.target.mode === 'idle') beginPendingInTx(tx);
    tx.state.pending_at = start;
    return { kind: 'done' as const, hit };
  }
  const open = tracking.openInTx(tx);
  const byCard = request.target.mode === 'ref' || request.target.mode === 'refToday';
  if (!open || (byCard ? open.card_id : open.id) !== request.target.id) throw new Error('已经换成别的事了');
  const since = request.target.mode === 'refToday' ? new Date(activityDayStartOf(activityDay(request.at, tx.settings.dayBoundaryHour), tx.settings.dayBoundaryHour)).toISOString() : undefined;
  const result = tracking.setReadoutInTx(tx, { entryId: open.id, mode: request.target.mode, at: request.at, milliseconds: request.milliseconds, since }, seen);
  return result.kind === 'confirm' ? { kind: 'confirm' as const, plan: result.plan, hit: result.plan.hit } : { kind: 'done' as const, hit: result.plan.hit };
}
export const commitReadout = (ctx: Ctx, request: HomeReadoutRequest, seen: ReadoutPlan | null) => action(ctx, request.at, tx => commitReadoutInTx(tx, request, seen), { action: 'home.commitReadout' });

/** The transport validates shape; identity checks happen after all earlier queued commits. */
export const dispatchMiniCommand = (ctx: Ctx, command: MiniCommand): Promise<MiniOutcome> => action(ctx, command.at, async tx => {
  if (command.entryId !== tx.state.open_entry || command.cardId !== tx.state.current_card) throw new Error('已经换成别的事了');
  if ('revision' in command && command.revision !== tx.revision) throw new Error('已经换成别的事了');
  if ('pending_id' in command && command.pending_id !== tx.state.pending_id) throw new Error('已经换成别的事了');
  switch (command.type) {
    case 'pause': tracking.pauseInTx(tx); break;
    case 'resume': await continueInTx(tx); break;
    case 'backToTask': await resumeInTx(tx); break;
    case 'beginPending': beginPendingInTx(tx); break;
    case 'cancelPending': cancelPendingInTx(tx, command.pending_id); break;
    case 'openMain': return { kind: 'openMain' };
    case 'complete': {
      const card = tx.cards.find(card => card.id === command.cardId);
      if (!card || !['待做', '进行中'].includes(card.status)) throw new Error('已经换成别的事了');
      // Completion needs the main-window progress dialog; only validate the target here.
      return { kind: 'complete', cardId: card.id, at: command.at };
    }
    case 'editOpen': {
      const open = tracking.openInTx(tx)!;
      if (tx.state.pending_id || open.project === '待机') {
        if (!command.patch.description?.trim()) throw new Error('请输入正在做的事');
        startFreeInTx(tx, { description: command.patch.description.trim(), project: command.patch.project ?? '未分类', tags: command.patch.tags ?? [] }, 'mini');
      } else editOpenInTx(tx, open.id, command.patch);
      break;
    }
    case 'editCard': {
      const card = tx.cards.find(card => card.id === command.cardId);
      if (!card || !['待做', '进行中'].includes(card.status)) throw new Error('已经换成别的事了');
      editContentInTx(tx, card.id, command.content);
      if (command.project !== undefined || command.tags !== undefined) editMetaInTx(tx, card.id, command.project === undefined ? card.project : command.project, command.tags ?? card.tags);
      break;
    }
    case 'setReadout': return commitReadoutInTx(tx, { target: command.target, milliseconds: command.milliseconds, at: command.at }, command.seen);
    // 0.3.0-beta.4 D1：小窗写新事件时选中自动完成里的一项，和主窗口同一套做法
    case 'startFavorite': startPresetInTx(tx, command.presetId); break;
    case 'startCard': {
      const card = tx.cards.find(card => card.id === command.targetCardId);
      if (!card || card.status !== '待做') throw new Error('这张卡已经不在待做里了');
      await startCardFromPendingInTx(tx, card.id); break;
    }
    case 'continueEntry': await continueEntryInTx(tx, command.targetEntryId); break;
  }
  return { kind: 'done' };
}, { action: `mini.${command.type}`, source: { kind: 'manual', via: 'mini' } });

function checkExpectedState(tx: Transaction, expectedState: string): void {
  const actual = timerStateTokenInTx(tx);
  if (actual !== expectedState) throw new Error(`STATE_CHANGED：当前计时状态已改变（expected=${expectedState}, actual=${actual}），请先查看最新状态`);
}
function checkNormalPreconditions(tx: Transaction, allowBreak = false): TimeEntry | null {
  if (tx.state.rest !== null) throw new Error('IN_DEGRADE_REST：当前处于降级休息状态，请先在单轨界面完成休息返回');
  const open = tracking.openInTx(tx);
  if (!allowBreak && open?.kind === '插入') throw new Error('IN_AWAY_ACTIVITY：当前正在进行临时离开活动，请先调用 return_from_break 结束临时活动');
  if (tx.state.pending_id !== null) throw new Error('PENDING_CONFIRMATION：单轨界面存在未确认的计时起点，请先在界面确认或放弃后再操作');
  return open;
}

export function startTimerCheckedInTx(tx: Transaction, input: { expected_state: string; description: string; project?: string; tags?: string[] }): { noop: boolean } {
  checkExpectedState(tx, input.expected_state);
  checkNormalPreconditions(tx, true);   // 插入中：替换插入的事（同界面，ADR 0021 第 3 条方法表）
  const description = input.description.trim();
  if (!description) throw new Error('INVALID_DESCRIPTION：活动描述不能为空');
  const project = validateUserProject(tx.settings.lists.projects, input.project);
  const tags = validateUserTags(input.tags);
  startFreeInTx(tx, { description, project, tags }, 'mcpTimer');
  alignInTx(tx);
  return { noop: false };
}

export async function startTaskItemCheckedInTx(tx: Transaction, input: { expected_state: string; card_id: string }): Promise<{ noop: boolean }> {
  checkExpectedState(tx, input.expected_state);
  if (!tx.settings.taskMode) throw new Error('TASK_MODE_OFF：单轨的任务模式关掉了，不能开始任务卡；可以用 start_timer 开始自由计时');
  const open = checkNormalPreconditions(tx);
  const card = tx.cards.find(item => item.id === input.card_id);
  if (!card) throw new Error('CARD_NOT_FOUND：找不到指定的待办事项卡片');
  if (card.status !== '待做' && card.status !== '进行中') throw new Error(`CARD_NOT_ACTIVE：该事项当前状态为「${card.status}」，不能开始计时`);
  if (card.status === '进行中' && open?.card_id === card.id && open.kind === '普通') return { noop: true };
  await startCardInTx(tx, card.id, tx.at);   // 插入中拒绝 IN_AWAY_ACTIVITY（检查在 startCardInTx 里）
  return { noop: false };
}

export function pauseTimerCheckedInTx(tx: Transaction, input: { expected_state: string }): { noop: boolean; reason: 'already_paused' | 'already_idle' | null } {
  checkExpectedState(tx, input.expected_state);
  const open = checkNormalPreconditions(tx, true);
  const inserting = tracking.insertStateInTx(tx);
  if (inserting === 'insertPaused') return { noop: true, reason: 'already_paused' };
  if (inserting === 'inserting') { tracking.pauseInTx(tx); alignInTx(tx); return { noop: false, reason: null }; }
  if (!open || open.kind === '暂停') return { noop: true, reason: 'already_paused' };
  if (open.project === '待机') return { noop: true, reason: 'already_idle' };
  tracking.pauseInTx(tx); alignInTx(tx);
  return { noop: false, reason: null };
}

export async function resumeTimerCheckedInTx(tx: Transaction, input: { expected_state: string }): Promise<{ noop: boolean; reason: 'already_running' | null }> {
  checkExpectedState(tx, input.expected_state);
  const open = checkNormalPreconditions(tx, true);
  if (open && open.project !== '待机') return { noop: true, reason: 'already_running' };
  if (tracking.insertStateInTx(tx) === 'insertPaused') { tracking.continueInsertInTx(tx); alignInTx(tx); return { noop: false, reason: null }; }
  const target = tx.state.resume_entry_id ? tx.entries.find(entry => entry.id === tx.state.resume_entry_id) : undefined;
  if (!target) throw new Error('NO_RESUME_TARGET：当前没有可继续的暂停活动，请使用 start_timer 或 start_task_item 开始新计时');
  await resumeInTx(tx); alignInTx(tx);
  return { noop: false, reason: null };
}

export function stopTimerCheckedInTx(tx: Transaction, input: { expected_state: string }): { noop: boolean; reason: 'already_idle' | null } {
  checkExpectedState(tx, input.expected_state);
  const open = checkNormalPreconditions(tx);   // 插入状态下拒绝 IN_AWAY_ACTIVITY（先 return_from_break 或在界面结束原任务）
  if (!open || (open.project === '待机' && open.kind === '普通' && tx.state.resume_entry_id === null)) return { noop: true, reason: 'already_idle' };
  tracking.stopInTx(tx); alignInTx(tx);
  return { noop: false, reason: null };
}

export function startBreakCheckedInTx(tx: Transaction, input: { expected_state: string; activity: string }): { noop: boolean } {
  checkExpectedState(tx, input.expected_state);
  checkNormalPreconditions(tx, true);
  const raw = input.activity.trim();
  if (!raw) throw new Error('INVALID_DESCRIPTION：临时活动名称不能为空');
  const preset = tx.settings.lists.presets.find(item => item.place === '弹层' && (item.id === raw || item.name === raw));
  const value: EntryTemplate = preset
    ? { description: preset.name, project: preset.project, tags: preset.tags, card_id: null }
    : { description: raw, project: '生活', tags: [], card_id: null };
  startOtherInTx(tx, value, 'mcpBreak'); alignInTx(tx);
  return { noop: false };
}

export async function returnFromBreakCheckedInTx(tx: Transaction, input: { expected_state: string }): Promise<{ noop: boolean }> {
  checkExpectedState(tx, input.expected_state);
  if (tx.state.rest !== null) throw new Error('IN_DEGRADE_REST：当前处于降级休息状态，请先在单轨界面完成休息返回');
  const open = tracking.openInTx(tx);
  if (!open || open.kind !== '插入') throw new Error('NOT_IN_BREAK：当前不在临时离开活动中，无需执行回来操作');
  await resumeInTx(tx); alignInTx(tx);
  return { noop: false };
}

/** 改一条已有计时记录（MCP / CLI update_time_entry）：时间走 updateRangeInTx、内容走 patchMetadataInTx，规则同日历。 */
export function updateTimeEntryCheckedInTx(tx: Transaction, input: { expected_state: string; entry_id: string; start?: string; end?: string; description?: string; project?: string; tags?: string[] }) {
  checkExpectedState(tx, input.expected_state);
  const entry = tx.entries.find(e => e.id === input.entry_id);
  if (!entry) throw new Error('ENTRY_NOT_FOUND：找不到这条计时记录，请先用 list_time_entries 查 ID');
  let overlaps: ReturnType<typeof tracking.overlaps> = [];
  if (input.start !== undefined || input.end !== undefined) {
    if (entry.ended_at === null && input.end !== undefined) throw new Error('ENTRY_RUNNING：正在计时的记录不能设结束时间，只能改开始');
    const start = input.start ?? entry.started_at, end = entry.ended_at === null ? null : input.end ?? entry.ended_at;
    // 新时段和这些已有记录重叠：日历同一套 overlay，非待机的并行保留、不改它们，只有被盖住的待机让出来（同 add_time_entry 回报）
    overlaps = tracking.overlaps(tx.entries.filter(e => e.id !== entry.id), start, end ?? tx.at, tx.at);
    tracking.updateRangeInTx(tx, entry.id, start, end);
  }
  const patch: Partial<Pick<EntryTemplate, 'description' | 'project' | 'tags'>> = {};
  if (input.description !== undefined) patch.description = input.description.trim();
  if (input.project !== undefined) patch.project = validateUserProject(tx.settings.lists.projects, input.project);
  if (input.tags !== undefined) patch.tags = validateUserTags(input.tags);
  if (Object.keys(patch).length) {
    if (entry.card_id && (patch.description !== undefined || patch.project !== undefined)) throw new Error('ENTRY_FROM_CARD：这条记录来自卡，描述和项目要在单轨里改卡');
    // 改开着的待机的项目等于从那一刻起在做这件事：交给 start_timer（G8 审核 S2）
    if (entry.ended_at === null && entry.project === '待机' && (patch.description !== undefined || patch.project !== undefined)) throw new Error('ENTRY_IS_IDLE：这是正在计的待机，不能改成别的活动；要从现在开始做一件事请用 start_timer');
    tracking.patchMetadataInTx(tx, entry.id, patch);
  }
  alignInTx(tx);
  return { entry: tx.entries.find(e => e.id === entry.id)!, overlaps };
}
export function addTimeEntryCheckedInTx(tx: Transaction, input: { description: string; start: string; end: string; project?: string; tags?: string[] }) {
  const description = input.description.trim();
  if (!description) throw new Error('INVALID_DESCRIPTION：补录活动描述不能为空');
  const project = validateUserProject(tx.settings.lists.projects, input.project);
  const tags = validateUserTags(input.tags);
  const overlaps = tracking.overlaps(tx.entries, input.start, input.end, tx.at);
  const entry = tracking.manualInTx(tx, { description, project, tags, card_id: null }, input.start, input.end, '手动');
  alignInTx(tx);
  return { entry, overlaps };
}
