// 进度竖条的格数映射（设计文档「对 UI 规范的影响」），首页和小窗共用。只做算术，不读时钟。
import { formatReadout } from '../shared/duration';

export const CELLS = 60;
export const MINI_CELLS = 30;

export type ProgressState = 'ready' | 'run' | 'away' | 'over';

export interface Progress { filled: number; miniFilled: number; state: ProgressState; overMs: number }

/**
 * elapsedMs 是这张卡在有效时间线上的累计时长；targetMinutes 为 null 表示结果卡。
 * - 结果卡：一格一分钟，满 60 格后整条变成 --ink，不再前进；没有超时状态。
 * - 时间盒卡：60 格按目标时长等分；计满以后是 over，并给出超出多少。
 * - 小窗 30 格是同一刻度的缩略版，一格对应两格。
 */
export function cardProgress(elapsedMs: number, targetMinutes: number | null, running: boolean, away = false): Progress {
  const ms = Math.max(0, elapsedMs);
  const perCell = targetMinutes === null ? 60_000 : (targetMinutes * 60_000) / CELLS;
  const filled = Math.min(CELLS, Math.floor(ms / perCell));
  const overMs = targetMinutes === null ? 0 : Math.max(0, ms - targetMinutes * 60_000);
  const reached = targetMinutes !== null && ms >= targetMinutes * 60_000;
  const state: ProgressState = reached ? 'over' : away ? 'away' : running ? 'run' : 'ready';
  return { filled, miniFilled: Math.floor(filled / 2), state, overMs };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 计时读数：不到 1 小时显示 MM:SS（不显示 00:），满 1 小时起进位成 HH:MM:SS。复用 shared/duration 唯一规则源。 */
export function formatMinutes(ms: number): string {
  return formatReadout(ms, 'mmss');
}

/** 标题栏状态块：超过一小时显示 h:mm:ss。 */
export function formatClock(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000), h = Math.floor(s / 3600);
  return h ? `${h}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
