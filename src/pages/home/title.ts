// 首页标题的字号自适应（UI风格规范 §3、§9.3）。[词] 的解析在 ui/marks/MarkedText。

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
