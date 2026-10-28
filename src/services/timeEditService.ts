import type { Ctx, Transaction } from './commit';
import { run } from './commit';
import * as tracking from './tracking/api';
import type { EntryTemplate } from './tracking/api';
import { alignInTx } from './cardService';
import { createCard } from '../domain/card/edit';
import { singleItemTask } from '../domain/task/pool';
import { activityDayStart, addDays } from '../shared/time';

type Instant = string | number;
function iso(value: Instant): string {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) throw new Error('时间无效');
  return new Date(time).toISOString();
}
const action = <T>(ctx: Ctx, at: string, work: (tx: Transaction) => T) => run(ctx, async tx => {
  const result = work(tx); alignInTx(tx); return result;
}, at);

/** Uses the startup index, including entries that began before the requested days. No IO or publish. */
export const queryRange = (ctx: Ctx, start: Instant, end: Instant, at = ctx.now()) =>
  structuredClone(tracking.inRange(ctx.repos.times.between(iso(start), iso(end)), iso(start), iso(end), at));
export function recentEntries(ctx: Ctx, days: number, at = ctx.now()) {
  if (!Number.isSafeInteger(days) || days <= 0) throw new Error('天数必须为正整数');
  const today = activityDayStart(Date.parse(at), ctx.settings.dayBoundaryHour);
  return queryRange(ctx, addDays(today, 1 - days), addDays(today, 1), at);
}
export const create = (ctx: Ctx, start: Instant, end: Instant, at: string, value: Omit<EntryTemplate, 'card_id'> = { description: '（无描述）', project: '未分类', tags: [] }) =>
  action(ctx, at, tx => tracking.manualInTx(tx, { ...value, card_id: null }, iso(start), iso(end), '日历').id);
export const update = (ctx: Ctx, id: string, start: Instant, end: Instant | null, at: string) =>
  action(ctx, at, tx => tracking.updateRangeInTx(tx, id, iso(start), end === null ? null : iso(end)));
export const move = (ctx: Ctx, id: string, start: Instant, at: string) => action(ctx, at, tx => tracking.moveInTx(tx, id, iso(start)));
export const copy = (ctx: Ctx, id: string, at: string, start?: Instant) => action(ctx, at, tx => tracking.copyInTx(tx, id, start === undefined ? undefined : iso(start)));
export const patch = (ctx: Ctx, id: string, value: Partial<Pick<EntryTemplate, 'description' | 'project' | 'tags'>>, at: string) =>
  action(ctx, at, tx => tracking.patchMetadataInTx(tx, id, value));
export const remove = (ctx: Ctx, id: string, at: string) => action(ctx, at, tx => tracking.deleteInTx(tx, id));
export const setStart = (ctx: Ctx, id: string, text: string, at: string) => action(ctx, at, tx => tracking.setStartInTx(tx, id, text));
export const setEnd = (ctx: Ctx, id: string, text: string, at: string) => action(ctx, at, tx => tracking.setEndInTx(tx, id, text));
export const setDuration = (ctx: Ctx, id: string, text: string, at: string) => action(ctx, at, tx => tracking.setDurationInTx(tx, id, text));
export const setShowIdle = (ctx: Ctx, on: boolean, at: string) => run(ctx, tx => tx.saveSettings({ ...tx.settings, calendarShowIdle: on }), at);
export const saveAsCard = (ctx: Ctx, entryId: string, at: string) => run(ctx, async tx => {
  const entry = tx.entries.find(entry => entry.id === entryId);
  if (!entry) throw new Error('计时条目不存在');
  if (entry.card_id) throw new Error('这条记录已经来自卡');
  const card = createCard(tx.id(), { content: entry.description, type: '结果卡', timeboxMinutes: null,
    blocking: false, dueAt: null, noShrink: false, taskId: null, project: entry.project, tags: entry.tags }, at,
  Math.max(0, ...tx.cards.map(card => card.order)) + 1);
  // Capturing past work follows E4, including when the side pool is full.
  const task = singleItemTask(card); tx.saveTask(task); tx.saveCard({ ...card, task_id: task.id });
  return card.id;
}, at);
