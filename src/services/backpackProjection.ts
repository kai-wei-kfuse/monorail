import type { Card } from '../domain/card/card';
import type { Task } from '../domain/task/task';
import { inBackpack } from '../domain/task/task';
import type { RecordEntry } from '../domain/record/record';
import type { BackpackSlice, QueueCard, PoolTask } from '../store/backpackSlice';
import type { TimeEntry } from '../domain/timeline/entry';
import type { Settings } from '../shared/settings';
import { refElapsedInTx } from './tracking/api';
import { knownTags } from '../domain/timeline/tags';
import { projectOptions } from '../domain/timeline/project';
import { coldOffer } from '../domain/idea/pool';
import { LOOSE } from '../shared/backpack';

export function projectBackpack(cards: Card[], tasks: Task[], records: RecordEntry[], entries: TimeEntry[], settings: Settings, at: string): BackpackSlice {
  const active = cards.filter(card => card.status === '待做' || card.status === '进行中');
  const queueCard = (card: Card): QueueCard => ({ id: card.id, status: card.status as QueueCard['status'],
    fields: { content: card.content, type: card.type, timeboxMinutes: card.timebox_minutes, blocking: card.blocking,
      dueAt: card.due_at, noShrink: card.no_shrink, taskId: card.task_id, project: card.project, tags: card.tags },
    shrinkLevel: card.shrink_level, skipCount: card.skip_count, progressNote: card.progress_note || null });
  const queue = (id: string | null) => active.filter(card => card.task_id === id).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map(queueCard);
  const orderedTasks = [...tasks].sort((a, b) => (a.slot_index ?? Infinity) - (b.slot_index ?? Infinity) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const poolTask = (task: Task): PoolTask => {
    const items = active.filter(card => card.task_id === task.id).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map(card => ({
      id: card.id, content: card.content, type: card.type, timeboxMinutes: card.timebox_minutes,
      elapsedMs: refElapsedInTx({ entries, at }, card.id), running: entries.some(entry => entry.card_id === card.id && entry.ended_at === null),
      blocking: card.blocking, dueAt: card.due_at, shrinkLevel: card.shrink_level, project: card.project, tags: card.tags,
    }));
    return { id: task.id, name: task.name, track: task.slot, defaultProject: task.default_project ?? '未分类', items,
      overLimit: task.slot === '主线' && items.length > settings.mainItems };
  };
  const sides = orderedTasks.filter(task => inBackpack(task) && task.slot === '支线').map(poolTask);
  return {
    pool: {
      mains: orderedTasks.filter(task => inBackpack(task) && task.slot === '主线').map(poolTask), sides,
      parked: orderedTasks.filter(task => task.status === '冷藏').map(task => ({ id: task.id, name: task.name, track: task.slot, itemCount: active.filter(card => card.task_id === task.id).length })),
      doneSides: orderedTasks.filter(task => task.status === '已完成' && task.slot === '支线').map(task => task.name),
      mainMax: settings.mainTasks, sideMax: settings.sideTasks, mainItems: settings.mainItems, projects: projectOptions(settings.lists.projects),
      knownTags: knownTags([...entries, ...settings.lists.presets, ...cards], settings.lists.tags), excessSideIds: sides.slice(settings.sideTasks).map(task => task.id),
    },
    tasks: orderedTasks.map(task => ({ id: task.id, name: task.name, slot: task.slot, slotIndex: task.slot_index,
      status: task.status, betEndsAt: task.bet_ends_at, openCards: active.filter(card => card.task_id === task.id).length })),
    queue: [...orderedTasks.filter(inBackpack).map(task => ({ taskId: task.id, name: task.name,
      slotLabel: String(task.slot_index).padStart(2, '0'), cards: queue(task.id) })), { taskId: null, name: LOOSE.group, slotLabel: LOOSE.slot, cards: queue(null) }],
    ideas: records.filter(record => record.kind === '想法' && (record.pool === '活跃池' || record.pool === '已转任务'))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
      .map(record => ({ id: record.id, text: record.text, tags: record.tags, needs: record.needs,
        pool: record.pool as '活跃池' | '已转任务', createdAt: record.created_at, lastTouchedAt: record.last_touched_at })),
    coldIdeas: coldOffer(records)
      .map(record => ({ id: record.id, text: record.text, needs: record.needs, coldSince: record.cold_since! })),
  };
}
