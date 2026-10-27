import { z } from 'zod';
import { settingEntries } from '../shared/settings';
import type { SettingKey, SettingValues } from '../shared/settings';

const iso = z.iso.datetime({ offset: true });
const nullableText = z.string().nullable();
export const recordSchema = z.object({
  id: z.uuid(), text: z.string(), kind: z.enum(['待办', '想法']), created_at: iso,
  due_at: iso.nullable(), blocking: z.boolean(), project_id: nullableText,
  card_id: nullableText, tags: z.array(z.string()), attachments: z.array(z.string()),
}).passthrough();
const currentCardSchema = z.object({
  id: z.string().min(1), source_record_id: z.uuid().nullable(), content: z.string(), created_at: iso,
  due_at: iso.nullable(), blocking: z.boolean(), project_id: nullableText,
  status: z.enum(['待做', '进行中', '已完成', '已缩小', '已放弃']), type: z.enum(['结果卡', '时间盒卡']), order: z.number(),
  timebox_minutes: z.number().positive().nullable(), no_shrink: z.boolean(), shrunk_from: nullableText,
  shrink_level: z.number().int().nonnegative(), continued_from: nullableText, skip_count: z.number().int().nonnegative(),
  completed_at: iso.nullable(), completed_day: nullableText,
  completed_track: z.enum(['主线', '支线']).nullable(), progress_note: z.string(),
}).passthrough().refine(card => card.type !== '时间盒卡' || card.timebox_minutes !== null, '时间盒缺少目标时长');
export const cardSchema = z.preprocess(value => {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'type' in value && value.type === '结果卡' && !('timebox_minutes' in value) && !('shrunk_from' in value)) {
    // Original M0 result cards did not have shrink/timebox metadata.
    return { ...value, timebox_minutes: null, no_shrink: false, shrunk_from: null, shrink_level: 0, continued_from: null, skip_count: 0 };
  }
  return value;
}, currentCardSchema);

export const projectSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), slot: z.enum(['主线', '支线', '不在背包']),
  slot_index: z.number().int().positive().nullable(), status: z.enum(['进行中', '冷藏', '已放弃']),
  created_at: iso, bet_ends_at: iso.nullable(),
}).passthrough();
export const reviewSchema = z.object({ id: z.string().min(1), period: z.string().regex(/^\d{4}-W\d{2}$/), status: z.enum(['未开始', '进行中', '已完成', '已被取代']), step: z.string().min(1) }).passthrough();
export const segmentSchema = z.object({
  id: z.uuid(), seq: z.number().int().positive(), started_at: iso, ended_at: iso.nullable(),
  activity: z.string(), category: z.string(), card_id: nullableText,
  kind: z.enum(['普通', '插入']), source: z.enum(['手动', '补记', '自动', '离线追问']), resume_card_id: nullableText,
}).refine(s => s.ended_at === null || Date.parse(s.ended_at) >= Date.parse(s.started_at), '结束时间早于开始时间');

const namedItem = z.object({ id: z.string().min(1), name: z.string().min(1) }).passthrough();
const uniqueIds = (items: { id: string }[]) => new Set(items.map(item => item.id)).size === items.length;
const listsSchema = z.object({
    quickActivities: z.array(namedItem.extend({ category: z.string().min(1) })).refine(uniqueIds, '快捷活动 id 重复'),
    restPool: z.array(namedItem).refine(uniqueIds, '休息项 id 重复'),
    idleName: z.string().min(1),
}).passthrough();
const settingShape = Object.fromEntries(settingEntries.map(entry => {
  if (entry.type === 'number') return [entry.key, z.number().int().min(entry.min).max(entry.max).refine(value => (value - entry.min) % entry.step === 0, '不符合设置步长')];
  if (entry.type === 'enum') return [entry.key, z.enum(entry.options)];
  return [entry.key, entry.type === 'boolean' ? z.boolean() : z.string().min(1)];
})) as { [K in SettingKey]: z.ZodType<SettingValues[K]> };
export const settingsSchema = z.object({ ...settingShape, schemaVersion: z.literal(1), lists: listsSchema }).passthrough();
export const legacySettingsSchema = z.object({
  dayBoundaryHour: z.number().int().min(0).max(23), deadlineLeadMinutes: z.number().nonnegative(), longActivityMinutes: z.number().positive(), lists: listsSchema,
}).passthrough();
