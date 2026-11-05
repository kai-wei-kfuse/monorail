import type { TimeEntry } from './entry';
import { isIdle } from './entry';

/**
 * 插入状态（ADR 0021 第 3 条状态表）。不加字段、不加枚举，按开着的条目和回到目标现算。
 * 前提：resume_entry_id 不为空（homeService.resumeInTx 先清它再开始卡，所以〔回到任务〕不会被「插入中不能开始卡」拦下）。
 * - inserting：开着的是插入的那件事（kind 插入、不是待机）；
 * - insertPaused：插入的事暂停了（开着「待机 / 插入」）；
 * - null：不在插入（含卡暂停中「待机 / 暂停」）。
 */
export type InsertState = 'inserting' | 'insertPaused' | null;
export function insertState(open: TimeEntry | null | undefined, resume: TimeEntry | null | undefined): InsertState {
  if (!open || !resume || open.kind !== '插入') return null;
  return isIdle(open) ? 'insertPaused' : 'inserting';
}

/** 正在做的卡：开着的条目带卡；插入或暂停时看回到目标那一条（同 tracking/api 的 activeRefInTx）。 */
export function activeCardOf(open: TimeEntry | null | undefined, resume: TimeEntry | null | undefined): string | null {
  return open?.card_id ?? (open && open.kind !== '普通' ? resume?.card_id ?? null : null);
}
