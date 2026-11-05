import { parse, stringify } from 'yaml';
import { z } from 'zod';
import type { DayPlan } from '../domain/plan/plan';
import { emptyPlan } from '../domain/plan/plan';
import type { FileSystem } from './fs';
import type { Write } from './journal';
import { createWrite } from './journal';

// 今日任务板（ADR 0021 第 1 条）：plans/<活动日>.yaml，一天一个文件；与业务写入同一份 journal。
// 0.3.0 / 0.2.5 不扫这个目录，退回时被忽略。坏文件报错，不静默覆盖。

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const iso = z.iso.datetime({ offset: true });
const itemSchema = z.strictObject({
  card_id: z.string().min(1), priority: z.enum(['普通', '高']),
  today_minutes: z.number().int().positive().nullable(), added_at: iso, carried: z.boolean(),
});
export const planSchema = z.strictObject({
  schemaVersion: z.literal(1), day,
  skip_until_planned: z.boolean(), carried_from: day.nullable(), carried_confirmed: z.boolean(), rolled_over: z.boolean(),
  seen: z.array(z.string()), items: z.array(itemSchema),
}).refine(plan => new Set(plan.items.map(item => item.card_id)).size === plan.items.length, '同一张卡在板子上出现了两次') satisfies z.ZodType<DayPlan>;

export const planPath = (value: string) => `plans/${day.parse(value)}.yaml`;

export interface PlanFile { value: DayPlan; text: string | null }
export class PlanRepo {
  constructor(private fs: FileSystem) {}
  /** 读一天的板子；没有文件时返回空板子（text 为 null，写的时候按新建处理）。 */
  async read(value: string): Promise<PlanFile> {
    const path = planPath(value), file = await this.fs.read(path);
    if (!file) return { value: emptyPlan(value), text: null };
    let plan: DayPlan;
    try { plan = planSchema.parse(parse(file.text)); }
    catch (error) { throw new Error(`${path}: 今日任务板文件格式不对`, { cause: error }); }
    if (plan.day !== value) throw new Error(`${path}: 文件里的日期是 ${plan.day}`);
    return { value: plan, text: file.text };
  }
  write(plan: DayPlan, original: PlanFile): Write {
    return createWrite(planPath(plan.day), stringify(planSchema.parse(plan)), original.text);
  }
  /** 保留期清理用：列出 plans/ 下所有日期（不读内容）。 */
  async days(): Promise<string[]> {
    const names = await this.fs.list('plans').catch(() => []);
    return names.map(name => name.replace(/^plans\//, '').replace(/\.yaml$/, '')).filter(name => day.safeParse(name).success).sort();
  }
  remove(value: string): Promise<void> { return this.fs.remove(planPath(value)); }
}
