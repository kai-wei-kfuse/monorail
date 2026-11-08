import { z } from 'zod';
import type { FileSystem } from './fs';
import { safeRelative } from './fs';
import type { Write } from './journal';
import { createWrite } from './journal';
import type { HistoryRecord } from '../shared/history';

// 操作历史的存储（ADR 0019 第 2 条）：一次操作一个文件 history/<活动日>/<HHmmssSSS>-<id>.json，与业务写入同一份 journal。
// 清理不经 journal（逐文件删除，可重复），由 commit.ts 的 maintain 串行。

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const change = z.strictObject({ type: z.enum(['entry', 'card', 'task', 'record', 'review', 'settings', 'state']), id: z.string(), name: z.string(),
  field: z.string(), before: z.string().nullable(), after: z.string().nullable() });
const agent = z.strictObject({ name: z.string().nullable(), raw: z.string().optional(), version: z.string().optional(),
  detected_by: z.enum(['mcp_handshake', 'env', 'flag', 'none']), evidence: z.string().optional() });
const source = z.union([
  z.strictObject({ kind: z.literal('manual'), via: z.enum(['main', 'mini', 'quickbar', 'idea-window']), page: z.string().optional() }),
  z.strictObject({ kind: z.literal('system'), trigger: z.enum(['dayChange', 'resume', 'reconcile']) }),
  z.strictObject({ kind: z.enum(['mcp', 'cli', 'automation']), agent }),
]);
export const historyRecordSchema = z.strictObject({
  version: z.literal(1), id: z.string().regex(/^[A-Za-z0-9-]+$/), at: z.iso.datetime({ offset: true }), day,
  action: z.string().min(1), label: z.string(), source, why: z.string().optional(),
  subject: z.strictObject({ type: change.shape.type, id: z.string(), text: z.string(), meta: z.string() }).nullable(),
  changes: z.array(change), effects: z.array(change),
  merged: z.number().int().min(2).optional(), reverted: z.boolean().optional(),
  call: z.strictObject({ method: z.string(), operation_id: z.string(), params: z.string(), truncated: z.boolean() }).optional(),
}) satisfies z.ZodType<HistoryRecord>;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** 文件名里的本地时刻 HHmmssSSS，同一天里按文件名排序就是时间顺序。 */
const stamp = (at: string) => { const d = new Date(at); return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}`; };
const PATH = /^history\/(\d{4}-\d{2}-\d{2})\/\d{9}-[A-Za-z0-9-]+\.json$/;
const newestFirst = (a: HistoryRecord, b: HistoryRecord) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id);

/** 写出去的一条：journal 计划里的 write，以及实际落盘的原文（设置合并改写时作为 before）。 */
export interface HistoryWrite { write: Write; path: string; text: string }

export class HistoryRepo {
  constructor(private fs: FileSystem) {}
  pathFor(record: HistoryRecord): string { return safeRelative(`history/${record.day}/${stamp(record.at)}-${record.id}.json`); }
  private encode(record: HistoryRecord) { return JSON.stringify(historyRecordSchema.parse(record), null, 2); }
  write(record: HistoryRecord): HistoryWrite {
    const path = this.pathFor(record), text = this.encode(record);
    return { write: createWrite(path, text, null), path, text };
  }
  /** 设置合并：沿用上一条的路径，before 是上一条实际落盘的原文（Journal.run 逐字节核对）。 */
  rewrite(prev: { path: string; rawText: string }, next: HistoryRecord): HistoryWrite {
    const text = this.encode(next);
    return { write: createWrite(prev.path, text, prev.rawText), path: prev.path, text };
  }
  /** history/ 下的全部历史文件（一次列目录），按路径排序。 */
  async listAll(): Promise<string[]> { return (await this.fs.list('history', true)).filter(p => PATH.test(p)).sort(); }
  /** 读 [fromDay, toDay] 里的历史（含两端），坏文件只计数、不中断。按时间从新到旧。 */
  /** older：fromDay 之前还有没有历史（列表页「再往前 7 天」用）。 */
  async readDays(fromDay: string, toDay: string): Promise<{ records: HistoryRecord[]; bad: number; older: boolean }> {
    const records: HistoryRecord[] = []; let bad = 0, older = false;
    for (const path of await this.listAll()) {
      const d = PATH.exec(path)![1];
      if (d < fromDay) older = true;
      if (d < fromDay || d > toDay) continue;
      const record = await this.readOne(path);
      if (record) records.push(record); else bad++;
    }
    return { records: records.sort(newestFirst), bad, older };
  }
  /**
   * 从最新往前读，交回满足 keep 的前 limit 条（设置 09「最近调用」）。最多读 maxFiles 个文件，
   * 不为了凑够条数把 180 天都读一遍。
   */
  async readRecent(limit: number, keep: (record: HistoryRecord) => boolean, maxFiles = 400): Promise<HistoryRecord[]> {
    const paths = (await this.listAll()).reverse().slice(0, maxFiles), out: HistoryRecord[] = [];
    // 同一天里文件名按本地时刻排，跨天按目录；读出来以后仍按 at 排一次（快速记录条补记的 at 可能早于文件所在顺序）
    for (const path of paths) {
      const record = await this.readOne(path);
      if (record && keep(record)) out.push(record);
      if (out.length >= limit * 2) break;
    }
    return out.sort(newestFirst).slice(0, limit);
  }
  private async readOne(path: string): Promise<HistoryRecord | null> {
    try { const file = await this.fs.read(path); return file ? historyRecordSchema.parse(JSON.parse(file.text)) : null; }
    catch { return null; }
  }
  /** 删掉活动日早于 cutoffDay 的历史（跳过 skip 里的路径），交回删掉了几个。删一个失败不影响其余。 */
  async removeBefore(cutoffDay: string, skip: ReadonlySet<string> = new Set()): Promise<{ removed: number; failed: number }> {
    let removed = 0, failed = 0;
    for (const path of await this.listAll()) {
      if (PATH.exec(path)![1] >= cutoffDay || skip.has(path)) continue;
      try { await this.fs.remove(path); removed++; } catch { failed++; }
    }
    return { removed, failed };
  }
}
