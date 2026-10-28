// 手动补录：开始、结束、时长三格填两格，算出要补的那一段（原型 home.js 的 ManualForm）。
import { parseClock, parseDuration } from '../../shared/duration';
import { HOUR } from '../../shared/time';

/**
 * 时刻取 now 之前最近的那一刻。开始、结束都填了而结束不晚于开始，结束算第二天的（跨过午夜）。只填时长 = 刚刚做完。
 * 结果的结束不能晚于 now。
 */
export function manualRange(startText: string, endText: string, durationText: string, now: number): { start: number; end: number } | { error: string } {
  let s = parseClock(startText, now), e = parseClock(endText, now);
  const d = parseDuration(durationText);
  if ([s, e, d].some(Number.isNaN)) return { error: '有一项看不懂：时刻写 9、930、9:30；时长写 90、1:30、1h 30m、1.5h' };
  if (s !== null && e !== null) { if (e <= s) e += 24 * HOUR; }
  else if (s !== null && d !== null) e = s + d;
  else if (e !== null && d !== null) s = e - d;
  else if (d !== null) { e = now; s = e - d; }
  else return { error: '开始、结束、时长里填两项（只填时长 = 刚刚做完）' };
  if (e! > now) return { error: '结束不能晚于现在' };
  if (e! <= s!) return { error: '时长要大于 0' };
  return { start: s!, end: e! };
}
