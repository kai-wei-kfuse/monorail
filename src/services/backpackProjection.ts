import type { Card } from '../domain/card/card';
import type { Project } from '../domain/project/project';
import { inBackpack } from '../domain/project/project';
import type { RecordEntry } from '../domain/record/record';
import type { BackpackSlice, QueueCard } from '../store/backpackSlice';
import { coldOffer } from '../domain/idea/pool';
import { LOOSE } from '../shared/backpack';

export function projectBackpack(cards: Card[], projects: Project[], records: RecordEntry[]): BackpackSlice {
  const active = cards.filter(card => card.status === '待做' || card.status === '进行中');
  const queueCard = (card: Card): QueueCard => ({ id: card.id, status: card.status as QueueCard['status'],
    fields: { content: card.content, type: card.type, timeboxMinutes: card.timebox_minutes, blocking: card.blocking,
      dueAt: card.due_at, noShrink: card.no_shrink, projectId: card.project_id },
    shrinkLevel: card.shrink_level, skipCount: card.skip_count, progressNote: card.progress_note || null });
  const queue = (id: string | null) => active.filter(card => card.project_id === id).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map(queueCard);
  const orderedProjects = [...projects].sort((a, b) => (a.slot_index ?? Infinity) - (b.slot_index ?? Infinity) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return {
    projects: orderedProjects.map(project => ({ id: project.id, name: project.name, slot: project.slot, slotIndex: project.slot_index,
      status: project.status, betEndsAt: project.bet_ends_at, openCards: active.filter(card => card.project_id === project.id).length })),
    queue: [...orderedProjects.filter(inBackpack).map(project => ({ projectId: project.id, name: project.name,
      slotLabel: String(project.slot_index).padStart(2, '0'), cards: queue(project.id) })), { projectId: null, name: LOOSE.group, slotLabel: LOOSE.slot, cards: queue(null) }],
    ideas: records.filter(record => record.kind === '想法' && (record.pool === '活跃池' || record.pool === '已转待办'))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
      .map(record => ({ id: record.id, text: record.text, tags: record.tags, needs: record.needs,
        pool: record.pool as '活跃池' | '已转待办', createdAt: record.created_at, lastTouchedAt: record.last_touched_at })),
    coldIdeas: coldOffer(records)
      .map(record => ({ id: record.id, text: record.text, needs: record.needs, coldSince: record.cold_since! })),
  };
}
