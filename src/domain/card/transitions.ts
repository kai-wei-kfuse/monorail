import type { Card } from './card';

export function startCard(card: Card): Card {
  if (card.status !== '待做' && card.status !== '进行中') throw new Error('卡片不可开始');
  return { ...card, status: '进行中' };
}
export function completeCard(card: Card, at: string, day: string, track: '主线' | '支线', note: string): Card {
  if (card.status !== '进行中') throw new Error('只有进行中的卡可以完成');
  return { ...card, status: '已完成', completed_at: at, completed_day: day, completed_track: track, progress_note: note };
}
export function abandonCard(card: Card): Card {
  if (card.status === '已缩小') throw new Error('先处理它缩小出来的卡');
  if (card.status === '已完成') throw new Error('已完成的卡不能放弃');
  return { ...card, status: '已放弃' };
}
export function continueCard(completed: Card, id: string, at: string, order: number): Card {
  if (completed.status !== '已完成' || completed.shrunk_from !== null) throw new Error('这张卡不能生成续卡');
  return { ...completed, id, created_at: at, order, status: '待做', continued_from: completed.id,
    completed_at: null, completed_day: null, completed_track: null, skip_count: 0 };
}
