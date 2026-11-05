import type { Card } from './card';

/**
 * 缩小 = 把一张卡拆成两张（ADR 0021 第 4 条，已定 50、54）。不设级数上限，不再产生「已缩小」状态。
 * - today：原来那张卡，id 不变（计时条目、板子上的项、正在计的状态都不动），改成「今天做的」内容和时长；
 * - rest：新卡，「剩下的」，排在原卡后面，不在板子上，带 split_note（原来的内容）供鼠标提示。
 * 时间盒：a + b = 原今天的量；today.timebox_minutes = 原 timebox_minutes − b，rest = b。
 * 约束：a ≥ 今天已计（向上取 5 分钟）、b ≥ 5、today.timebox_minutes ≥ 这张卡的总已计；两句内容都不能为空。
 */
export interface SplitInput {
  id: string; at: string; order: number;
  todayContent: string; restContent: string;
  /** 时间盒才有：剩下的分钟（b） */
  restMinutes: number | null;
  /** 时间盒：原今天的量（板子上的 today_minutes；不在板子上时 = 剩下的时长） */
  todayGoal: number | null;
  /** 今天已计、总已计（分钟） */
  minutesToday: number; minutesTotal: number;
}
export type SplitCard = Card & { split_note?: string };

export function splitCard(card: Card, input: SplitInput): { today: Card; rest: SplitCard; todayMinutes: number | null } {
  if (card.status !== '待做' && card.status !== '进行中') throw new Error('卡片不可缩小');
  const todayContent = input.todayContent.trim(), restContent = input.restContent.trim();
  if (!todayContent || !restContent) throw new Error('今天做的、剩下的两句都要写');
  let todayMinutes: number | null = null, restMinutes: number | null = null, total = card.timebox_minutes;
  if (card.type === '时间盒卡') {
    const goal = input.todayGoal, b = input.restMinutes;
    if (goal === null || b === null || !Number.isInteger(b)) throw new Error('时间盒要分今天做多少、剩下多少');
    const a = goal - b;
    if (b < 5) throw new Error('剩下的至少 5 分钟');
    if (a < Math.ceil(input.minutesToday / 5) * 5 || a <= 0) throw new Error('今天做的不能少于今天已经计的时间');
    total = (card.timebox_minutes ?? goal) - b;
    if (total < input.minutesTotal) throw new Error('今天这份的时长不能少于这张卡已经计的时间');
    todayMinutes = a; restMinutes = b;
  }
  const today: Card = { ...card, content: todayContent, timebox_minutes: total, shrink_level: card.shrink_level + 1, skip_count: 0 };
  const rest: SplitCard = { ...card, id: input.id, created_at: input.at, content: restContent, order: input.order, status: '待做',
    timebox_minutes: restMinutes, shrunk_from: card.id, shrink_level: card.shrink_level + 1, continued_from: null, skip_count: 0,
    completed_at: null, completed_day: null, completed_track: null, progress_note: '', progress_noted_at: null, split_note: card.content };
  return { today, rest, todayMinutes };
}

/** 0.3.0 留下的「已缩小」父卡：子卡完成后父卡回待做（旧数据照 0.3.0 规则处理，ADR 0021 第 4 条）。 */
export function restoreParent(child: Card, parent: Card, note: string): Card {
  if (child.shrunk_from !== parent.id || parent.status !== '已缩小') throw new Error('缩小链状态不一致');
  return { ...parent, status: '待做', progress_note: note };
}

/** 鼠标提示「从哪一项缩小来的」：只在 shrunk_from 指向的卡不是「已缩小」时读 split_note（0.3.0 缩小时会把它复制给子卡，第 2 轮 S3）。 */
export function splitOrigin(card: SplitCard, parent: Card | undefined): string | null {
  if (!card.split_note || !parent || parent.status === '已缩小') return null;
  return card.split_note;
}
