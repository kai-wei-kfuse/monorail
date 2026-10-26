import { z } from 'zod';

const iso = z.iso.datetime({ offset: true });
const nullableText = z.string().nullable();
export const recordSchema = z.object({
  id: z.uuid(), text: z.string(), kind: z.enum(['待办', '想法']), created_at: iso,
  due_at: iso.nullable(), blocking: z.boolean(), project_id: nullableText,
  card_id: nullableText, tags: z.array(z.string()), attachments: z.array(z.string()),
}).passthrough();
export const cardSchema = z.object({
  id: z.string().regex(/^card-[0-9a-f-]+$/), source_record_id: z.uuid(), content: z.string(), created_at: iso,
  due_at: iso.nullable(), blocking: z.boolean(), project_id: nullableText,
  status: z.enum(['待做', '进行中', '已完成']), type: z.literal('结果卡'), order: z.number(),
  completed_at: iso.nullable(), completed_day: nullableText,
  completed_track: z.enum(['主线', '支线']).nullable(), progress_note: z.string(),
}).passthrough();
export const segmentSchema = z.object({
  id: z.uuid(), seq: z.number().int().positive(), started_at: iso, ended_at: iso.nullable(),
  activity: z.string(), category: z.string(), card_id: nullableText,
  kind: z.enum(['普通', '插入']), source: z.enum(['手动', '补记', '自动', '离线追问']), resume_card_id: nullableText,
});
