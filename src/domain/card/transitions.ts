import type { Card } from './card';

export function startCard(card: Card): Card {
  if (card.status !== '待做' && card.status !== '进行中') throw new Error('卡片不可开始');
  return { ...card, status: '进行中' };
}
export function releaseCard(card: Card): Card { return card.status === '进行中' ? { ...card, status: '待做' } : card; }
export function completeCard(card: Card, at: string, day: string, track: '主线' | '支线', note: string): Card {
  if (card.status !== '进行中') throw new Error('只有进行中的卡可以完成');
  return completeCardItem(card, at, day, track, note);
}
export function completeCardItem(card: Card, at: string, day: string, track: '主线' | '支线', note?: string): Card {
  if (card.status !== '待做' && card.status !== '进行中') throw new Error('只有待做或进行中的卡可以完成');
  return { ...card, status: '已完成', completed_at: at, completed_day: day, completed_track: track, progress_note: note ?? card.progress_note };
}
export function reopenCardItem(card: Card): Card {
  if (card.status !== '已完成') throw new Error('只有已完成的卡可以取消完成');
  return { ...card, status: '待做', completed_at: null, completed_day: null, completed_track: null };
}
export function restoreCardFromSnapshot(card: Card, before: {
  status: '待做' | '进行中';
  completed_at: string | null;
  completed_day: string | null;
  completed_track: '主线' | '支线' | null;
}): Card {
  if (card.status !== '已完成') throw new Error('只有已完成的卡可以按快照恢复');
  return { ...card, status: '待做', completed_at: before.completed_at, completed_day: before.completed_day, completed_track: before.completed_track };
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
