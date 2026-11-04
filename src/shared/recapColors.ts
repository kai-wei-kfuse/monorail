// 回看图表的颜色（原型 recap-prototype.html 的 CFG，UI 风格规范 §11.12）。项目色取设置里各项目的颜色。
import { NO_TAG, OTHER } from './recap';
import type { RecapDimension } from './recap';

export const RECAP_SYSTEM_COLORS: Record<string, string> = { 待机: '#a3a39e', 睡眠: '#5b5f97', 休息: '#6fd3a8', 离线: '#7a7a76', 回顾: '#2b2b2a' };
export const RECAP_SOURCE_COLORS: Record<string, string> = { 主线任务: '#161616', 支线任务: '#00b4ff', 自由活动: '#d9a400', 临时离开: '#ff5a3c' };
export const RECAP_PALETTE = ['#161616', '#ff5a3c', '#00b4ff', '#00c389', '#d9a400', '#8f6bff', '#c0392b', '#16a085', '#ff9f1c', '#7a8b3a'];
export const RECAP_OTHER_COLOR = '#cfcfc9';
export const RECAP_NO_TAG_COLOR = '#cfcfc9';
const FALLBACK = '#888884';

/** 按名字稳定取色：同一个标签在任何周期、任何排名下颜色都一样。 */
function stable(name: string): string {
  let h = 0;
  for (const ch of name) h = (Math.imul(h, 31) + ch.codePointAt(0)!) >>> 0;
  return RECAP_PALETTE[h % RECAP_PALETTE.length];
}

/**
 * 一组的颜色。rank 是这一组在当前维度里按时长的名次（0 起）。
 * 项目：设置里的颜色，系统项固定色；标签：按名字稳定取色，无标签灰；来源：固定四色；
 * 具体活动：按名次轮流取色，第 9 名起用「其他」灰。
 */
export function recapColor(dim: RecapDimension, key: string, rank: number, projectColors: Record<string, string>): string {
  if (key === OTHER) return RECAP_OTHER_COLOR;
  if (key in RECAP_SYSTEM_COLORS && (dim !== 'activity')) return RECAP_SYSTEM_COLORS[key];
  switch (dim) {
    case 'project': return projectColors[key] ?? FALLBACK;
    case 'tag': return key === NO_TAG ? RECAP_NO_TAG_COLOR : stable(key);
    case 'source': return RECAP_SOURCE_COLORS[key] ?? FALLBACK;
    case 'activity': return rank < 8 ? RECAP_PALETTE[rank % RECAP_PALETTE.length] : RECAP_OTHER_COLOR;
  }
}
