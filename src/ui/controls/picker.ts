// 项目选择、标签选择共用的纯函数。

/** 输入框里的字当标签名：去掉首尾空白和开头的 #。 */
export const tagName = (raw: string) => raw.trim().replace(/^#+/, '').trim();

/** 按输入筛选，不分大小写；没有输入时列出全部。 */
export function matching(names: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  return q ? names.filter(n => n.toLowerCase().includes(q)) : names;
}

export type EnterChoice = { pick: string } | { create: string } | null;

/**
 * 回车该做什么：用上下键选中了一项就用它；否则有同名的就选它；都没有、又允许新建时新建；没写字就什么都不做。
 * shown 是弹层里列出的那几项，active 是选中的序号（-1 表示没选），all 是全部已有的名字。
 */
export function enterChoice(shown: string[], all: string[], name: string, active: number, canCreate: boolean): EnterChoice {
  if (active >= 0 && active < shown.length) return { pick: shown[active] };
  if (!name) return null;
  if (all.includes(name)) return { pick: name };
  return canCreate ? { create: name } : null;
}

/**
 * 弹层往哪边开，返回加在 .combo-pop 上的类名：靠近窗口底部就向上（up），靠近右边就和控件的右边对齐（end）。
 * rect 是控件的位置；size 是弹层大概的尺寸（最宽约 200、最高 260 加边距）。
 */
export function popupPlacement(rect: { left: number; bottom: number }, viewport: { width: number; height: number },
  size = { width: 200, height: 270 }): string {
  return `${rect.bottom + size.height > viewport.height ? ' up' : ''}${rect.left + size.width > viewport.width ? ' end' : ''}`;
}

/** 上下键在列出的几项里移动；没选时，向下到第一项、向上到最后一项。 */
export function moveActive(active: number, count: number, down: boolean): number {
  if (!count) return -1;
  if (active < 0) return down ? 0 : count - 1;
  return (active + (down ? 1 : -1) + count) % count;
}
