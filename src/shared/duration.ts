// 时长、时刻、读数的写法（原型 home.js 的 parseDuration / parseClock / parseElapsed）。读数输入框、手动补录、列表、
// 计时系统都用这一份。返回毫秒；空白返回 null，认不出的写法返回 NaN。
import { MINUTE } from './time';

/** 时长：90 = 90 分钟；1:30 = 1 小时 30 分；也认 1h 30m、1.5h、45min。 */
export function parseDuration(text: string): number | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  let m = /^(\d+)$/.exec(s);
  if (m) return +m[1] * MINUTE;
  m = /^(\d+):(\d{1,2})$/.exec(s);
  if (m) return (+m[1] * 60 + +m[2]) * MINUTE;
  m = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/.exec(s);
  if (m && (m[1] || m[2])) return ((+(m[1] ?? 0)) * 60 + +(m[2] ?? 0)) * MINUTE;
  return NaN;
}

/** 时刻：9、930、9:30。取 now 之前最近的那一刻：比 now 晚就算前一天的。 */
export function parseClock(text: string, now: number): number | null {
  const s = text.trim();
  if (!s) return null;
  const m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(s);
  if (!m || +m[1] > 23 || +(m[2] ?? 0) > 59) return NaN;
  const d = new Date(now);
  d.setHours(+m[1], +(m[2] ?? 0), 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

/** 读数显示成哪种格式：「分:秒」或「时:分:秒」。冒号写法按这个来理解。 */
export type ReadoutKind = 'mmss' | 'hms';

/**
 * 在读数上直接输入的新读数。45 = 45 分钟；「分:秒」读数里 45:30 = 45 分 30 秒，「时:分:秒」读数里 1:30 = 1 小时 30 分；
 * 1:02:03 总是时:分:秒；也认 parseDuration 的写法。+10 / -5 = 在当前读数 shown 上加减（加减的部分照同样的写法）。
 * 结果可能小于 0，由计时系统拒绝。
 */
export function parseReadout(text: string, kind: ReadoutKind, shown: number): number | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  let m = /^([+-])\s*(.+)$/.exec(s);
  if (m) {
    const d = parseReadout(m[2], kind, 0);
    return d !== null && Number.isFinite(d) ? shown + (m[1] === '-' ? -d : d) : NaN;
  }
  if ((m = /^(\d+)$/.exec(s))) return +m[1] * MINUTE;
  if ((m = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(s))) return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000;
  if ((m = /^(\d+):(\d{1,2})$/.exec(s))) return kind === 'mmss' ? (+m[1] * 60 + +m[2]) * 1000 : (+m[1] * 60 + +m[2]) * MINUTE;
  return parseDuration(s);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 读数的显示：mmss 不到 1 小时写成 MM:SS（不显示 00:）、满 1 小时起进位成 HH:MM:SS；hms 始终写成 HH:MM:SS。负数按 0。 */
export function formatReadout(ms: number, kind: ReadoutKind = 'mmss'): string {
  const sec = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(sec / 3600);
  const mmss = `${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
  return kind === 'hms' || h > 0 ? `${pad(h)}:${mmss}` : mmss;
}
