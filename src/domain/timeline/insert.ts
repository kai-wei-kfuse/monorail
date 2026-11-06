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

/**
 * 从哪个入口开始别的事（ADR 0021 第 3 条入口表）。
 * quick：快捷活动（预设 place 弹层）；temp：临时活动；其余都是「计时框、小窗新事件、收藏、最近的记录、继续这一条、MCP start_timer」一类。
 */
export type EntrySource = 'quick' | 'temp' | 'favorite' | 'timerBox' | 'mini' | 'recent' | 'continue' | 'mcpTimer' | 'mcpBreak';
export type EntryAction = 'insert' | 'replace' | 'switch' | 'start';
const ALWAYS_INSERT: readonly EntrySource[] = ['quick', 'temp', 'mcpBreak'];

/**
 * 入口判断（判断放在各 InTx 内部，调用方不用逐个改）：
 * - 插入中 / 插入的事暂停了：替换插入的事（resume_entry_id 不变）；
 * - 一张卡在计时，或卡暂停中（待机 / 暂停，回到目标是卡）：插入；
 * - 自由记录在计时：快捷活动、临时活动插入，其余切换；
 * - 自由记录暂停中（待机 / 暂停，回到目标是自由记录）：快捷活动、临时活动插入（保留暂停前的回到目标，同 0.2.5 / ADR 0006），其余直接开始；
 * - 待机 / 什么都没在计：直接开始。
 * 「继续这一条」继续的正是原来那张卡时，由调用方当作〔回到任务〕处理，不经过这里。
 */
export function entryAction(open: TimeEntry | null | undefined, resume: TimeEntry | null | undefined, source: EntrySource): EntryAction {
  if (insertState(open, resume)) return 'replace';
  if (!open) return 'start';
  const cardRunning = open.card_id !== null && open.kind === '普通';
  const cardPaused = open.kind === '暂停' && !!resume?.card_id;
  if (cardRunning || cardPaused) return 'insert';
  const freeRunning = open.kind === '普通' && !isIdle(open);
  if (freeRunning) return ALWAYS_INSERT.includes(source) ? 'insert' : 'switch';
  const freePaused = open.kind === '暂停' && !!resume;
  if (freePaused && ALWAYS_INSERT.includes(source)) return 'insert';
  return 'start';
}

/**
 * 插入的事暂停后〔继续〕要接着的那一段（第 3 轮 N1）：回到目标那条之后、最后结束的那条插入，
 * 它的结束不晚于开着的待机的开始，且两者之间没有别的非待机条目。找不到返回 null（界面灰掉〔继续〕）。
 */
export function insertToContinue(entries: readonly TimeEntry[], open: TimeEntry, resume: TimeEntry): TimeEntry | null {
  const after = Date.parse(resume.ended_at ?? resume.started_at), idleStart = Date.parse(open.started_at);
  const closed = entries.filter(e => e.id !== open.id && e.ended_at !== null && Date.parse(e.ended_at) <= idleStart && Date.parse(e.started_at) >= after);
  const last = closed.sort((a, b) => Date.parse(a.ended_at!) - Date.parse(b.ended_at!)).at(-1);
  if (!last || last.kind !== '插入' || isIdle(last)) return null;
  const between = closed.filter(e => Date.parse(e.started_at) >= Date.parse(last.ended_at!) && !isIdle(e));
  return between.length ? null : last;
}

/**
 * 这件插入的事前面已经计完的那几段之和（用户 2026-11-06：暂停不重置读数）。读数 = 这个 + 开着的那一段。
 * 从开着的那条往前找：插入的事暂停（待机 / 插入）跳过，同名同项目的插入段加上，碰到别的事就停。
 * 只看回到目标那条之后的；不改数据，日历、列表里照旧是分开的几段。
 */
export function insertClosedMs(entries: readonly TimeEntry[], open: TimeEntry, resume: TimeEntry): number {
  const name = isIdle(open) ? insertToContinue(entries, open, resume) : open;
  if (!name) return 0;
  const after = Date.parse(resume.ended_at ?? resume.started_at), openStart = Date.parse(open.started_at);
  const closed = entries.filter(e => e.id !== open.id && e.ended_at !== null && Date.parse(e.started_at) >= after && Date.parse(e.ended_at) <= openStart)
    .sort((a, b) => Date.parse(b.ended_at!) - Date.parse(a.ended_at!));
  let sum = 0;
  for (const e of closed) {
    if (isIdle(e) && e.kind === '插入') continue;
    if (e.kind !== '插入' || isIdle(e) || e.description !== name.description || e.project !== name.project) break;
    sum += Date.parse(e.ended_at!) - Date.parse(e.started_at);
  }
  return sum;
}
