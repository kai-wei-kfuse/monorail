import type { Card } from './card';
import type { CardFields } from '../../shared/backpack';

export function editCardContent(card: Card, content: string): Card {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('卡片内容不能为空');
  return { ...card, content: trimmed, skip_count: 0 };
}

export function editCard(card: Card, fields: CardFields): Card {
  const edited = editCardContent(card, fields.content);
  if (fields.type === '时间盒卡' && !(fields.timeboxMinutes !== null && Number.isFinite(fields.timeboxMinutes) && fields.timeboxMinutes > 0)) throw new Error('时间盒需要正数时长');
  if (fields.dueAt !== null && !Number.isFinite(Date.parse(fields.dueAt))) throw new Error('期限不是有效时间');
  return { ...edited, type: fields.type, timebox_minutes: fields.type === '结果卡' ? null : fields.timeboxMinutes,
    due_at: fields.dueAt, blocking: fields.blocking, no_shrink: fields.noShrink, task_id: fields.taskId,
    project: fields.project === undefined ? card.project : fields.project?.trim() || null,
    tags: fields.tags === undefined ? card.tags : [...new Set(fields.tags.map(tag => tag.trim()).filter(Boolean))] };
}

export function createCard(id: string, fields: CardFields, at: string, order: number): Card {
  return editCard({ id, source_record_id: null, content: '', created_at: at, due_at: null, blocking: false, task_id: null,
    project: null, tags: [], status: '待做', type: '结果卡', order, timebox_minutes: null, no_shrink: false, shrunk_from: null, shrink_level: 0,
    continued_from: null, skip_count: 0, completed_at: null, completed_day: null, completed_track: null, progress_note: '' }, fields);
}
