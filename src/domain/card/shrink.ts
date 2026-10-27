import type { Card } from './card';

export interface ShrinkInput { id: string; at: string; content: string; type: Card['type']; minutes: number | null; order: number; maxLevel: number }
export function shrinkCard(card: Card, input: ShrinkInput): { parent: Card; child: Card } {
  if (!['待做', '进行中'].includes(card.status)) throw new Error('卡片不可缩小');
  if (card.no_shrink || card.shrink_level >= input.maxLevel) throw new Error('已达到缩小限制');
  if (!input.content.trim()) throw new Error('缩小内容不能为空');
  if (input.type === '时间盒卡' && !(input.minutes !== null && input.minutes > 0)) throw new Error('时间盒需要正数时长');
  return {
    parent: { ...card, status: '已缩小', skip_count: 0 },
    child: { ...card, id: input.id, created_at: input.at, content: input.content, order: input.order,
      type: input.type, timebox_minutes: input.type === '时间盒卡' ? input.minutes : null,
      shrunk_from: card.id, shrink_level: card.shrink_level + 1, continued_from: null,
      skip_count: 0, no_shrink: false, completed_at: null, completed_day: null, completed_track: null },
  };
}
export function restoreParent(child: Card, parent: Card, note: string): Card {
  if (child.shrunk_from !== parent.id || parent.status !== '已缩小') throw new Error('缩小链状态不一致');
  return { ...parent, status: '待做', progress_note: note };
}
