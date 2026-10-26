// 首页标题：[词] 重点词解析 + 字号自适应（UI风格规范 §3、§9.3）。

export interface TitlePart { text: string; mark: boolean }

/** 把「沿 [Python] 往下学」拆成普通段和重点词段。没配对的方括号按原文保留。 */
export function parseMarks(content: string): TitlePart[] {
  const parts: TitlePart[] = [];
  const re = /\[([^\]\n]+)\]/g;
  let last = 0;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    if (m.index > last) parts.push({ text: content.slice(last, m.index), mark: false });
    parts.push({ text: m[1], mark: true });
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push({ text: content.slice(last), mark: false });
  return parts;
}

/** 其他地方显示卡片内容时去掉方括号。 */
export const plainTitle = (content: string) => parseMarks(content).map(p => p.text).join('');

export const TITLE_MAX = 96;
export const TITLE_MIN = 26;

/**
 * 找出标题在可用宽高内能放下的最大字号，取它和 96px 中较小的那个，再乘以字号比例（默认 65%）。
 * fits(size) 由调用方在 DOM 上量：该字号下内容不溢出就返回 true。二分查找，最多量 7 次。
 */
export function fitTitleSize(fits: (size: number) => boolean, scalePercent: number): number {
  let lo = TITLE_MIN, hi = TITLE_MAX;
  if (fits(hi)) lo = hi;
  else while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid; }
  return Math.max(TITLE_MIN, Math.floor(lo * scalePercent / 100));
}
