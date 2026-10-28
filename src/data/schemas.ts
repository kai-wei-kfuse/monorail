import { z } from 'zod';
import { settingEntries } from '../shared/settings';
import type { SettingKey, SettingValues } from '../shared/settings';
import { safeRelative } from './fs';

const iso = z.iso.datetime({ offset: true });
const nullableText = z.string().nullable();
const attachmentPath = z.string().refine(value => {
  // Attachments are copied into the data directory by the platform boundary.
  try { return safeRelative(value).startsWith('attachments/'); } catch { return false; }
}, '附件必须是 attachments/ 下的相对路径');
export const recordSchema = z.object({
  id: z.uuid(), text: z.string(), kind: z.enum(['待办', '想法']), created_at: iso,
  due_at: iso.nullable(), blocking: z.boolean(), task_id: nullableText,
  card_id: nullableText, tags: z.array(z.string()), attachments: z.array(attachmentPath),
  needs: nullableText, pool: z.enum(['活跃池', '冷库', '已转任务']).nullable(),
  last_touched_at: iso, cold_since: iso.nullable(),
}).passthrough().refine(record => record.kind === '想法' ? record.pool !== null : record.pool === null, '记录类型与想法池状态不一致')
  .refine(record => record.pool === '冷库' ? record.cold_since !== null : record.cold_since === null, '冷库时间与状态不一致')
  .refine(record => record.pool !== '已转任务' || record.card_id !== null, '已转任务的想法缺少卡片');
export const cardSchema = z.object({
  id: z.string().min(1), source_record_id: z.uuid().nullable(), content: z.string(), created_at: iso,
  due_at: iso.nullable(), blocking: z.boolean(), task_id: nullableText,
  project: nullableText, tags: z.array(z.string()),
  status: z.enum(['待做', '进行中', '已完成', '已缩小', '已放弃']), type: z.enum(['结果卡', '时间盒卡']), order: z.number(),
  timebox_minutes: z.number().positive().nullable(), no_shrink: z.boolean(), shrunk_from: nullableText,
  shrink_level: z.number().int().nonnegative(), continued_from: nullableText, skip_count: z.number().int().nonnegative(),
  completed_at: iso.nullable(), completed_day: nullableText,
  completed_track: z.enum(['主线', '支线']).nullable(), progress_note: z.string(), progress_noted_at: iso.nullable().optional(),
}).passthrough().refine(card => card.type !== '时间盒卡' || card.timebox_minutes !== null, '时间盒缺少目标时长');

export const taskSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), slot: z.enum(['主线', '支线']),
  slot_index: z.number().int().positive().nullable(), status: z.enum(['进行中', '冷藏', '已放弃', '已完成']), default_project: nullableText,
  created_at: iso, bet_ends_at: iso.nullable(),
}).passthrough();
const reviewStep = z.enum(['recap', 'newIdeas', 'arena', 'coldPick', 'bet']);
export const reviewSchema = z.object({
  id: z.string().min(1), period: z.string().regex(/^\d{4}-W\d{2}$/), status: z.enum(['未开始', '进行中', '已完成', '已被取代']),
  step: z.union([reviewStep, z.literal('done')]), done: z.array(reviewStep).optional(),
  started_at: iso.nullable().optional(), completed_at: iso.nullable().optional(),
  added_idea_ids: z.array(z.string()).optional(), bet_task_ids: z.array(z.string()).optional(), bet_done_ids: z.array(z.string()).optional(),
  cold_duel: z.object({ left: z.string(), right: z.string() }).nullable().optional(),
  timer_entry_id: z.uuid().nullable().optional(),
}).passthrough().refine(row => row.done === undefined || (row.started_at !== undefined && row.completed_at !== undefined &&
  row.added_idea_ids !== undefined && row.bet_task_ids !== undefined && row.bet_done_ids !== undefined && row.cold_duel !== undefined), '回顾进度字段不完整')
  .refine(row => row.done === undefined || row.status !== '已完成' || row.completed_at !== null, '已完成回顾缺少完成时间');
const namedItem = z.object({ id: z.string().min(1), name: z.string().min(1) }).passthrough();
const uniqueIds = (items: { id: string }[]) => new Set(items.map(item => item.id)).size === items.length;
const listsSchema = z.object({
    presets: z.array(namedItem.extend({ project: z.string().min(1), tags: z.array(z.string()), mode: z.enum(['切换', '插入']), place: z.enum(['计时条', '弹层']) })).refine(uniqueIds, '预设 id 重复'),
    projects: z.array(z.object({ name: z.string().min(1), color: z.string().min(1) })), tags: z.array(z.string()),
    restPool: z.array(namedItem).refine(uniqueIds, '休息项 id 重复'),
    idleName: z.string().min(1),
}).passthrough();
const settingShape = Object.fromEntries(settingEntries.map(entry => {
  if (entry.type === 'number') return [entry.key, z.number().int().min(entry.min).max(entry.max).refine(value => (value - entry.min) % entry.step === 0, '不符合设置步长')];
  if (entry.type === 'enum') return [entry.key, z.enum(entry.options)];
  return [entry.key, entry.type === 'boolean' ? z.boolean() : z.string().min(1)];
})) as { [K in SettingKey]: z.ZodType<SettingValues[K]> };
export const settingsSchema = z.object({ ...settingShape, schemaVersion: z.literal(2), lists: listsSchema }).passthrough();

export const entrySchema = z.object({
  id: z.string().min(1), started_at: z.iso.datetime({ offset: true }), ended_at: z.iso.datetime({ offset: true }).nullable(),
  description: z.string(), project: z.string().min(1), tags: z.array(z.string()), card_id: z.string().nullable(),
  kind: z.enum(['普通', '插入', '暂停']), source: z.enum(['计时', '手动', '日历', '自动', '离线追问']),
  updated_at: z.iso.datetime({ offset: true }),
});
