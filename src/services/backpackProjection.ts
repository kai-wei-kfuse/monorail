import type { Card } from '../domain/card/card';
import { activityDay } from '../domain/timeline/day';
import type { Task } from '../domain/task/task';
import { inBackpack } from '../domain/task/task';
import { verifyTaskReopen } from '../domain/task/complete';
import { computeRecordRevision } from '../domain/record/record';
import type { RecordEntry } from '../domain/record/record';
import type { BackpackSlice, QueueCard, PoolTask } from '../store/backpackSlice';
import type { TimeEntry } from '../domain/timeline/entry';
import type { Settings } from '../shared/settings';
import { refElapsedInTx } from './tracking/api';
import { knownTags } from '../domain/timeline/tags';
import { projectOptions } from '../domain/timeline/project';
import { coldOffer, doneIdeas } from '../domain/idea/pool';
import { LOOSE } from '../shared/backpack';

export interface ProjectedRecordSummary {
  hasDetails: boolean;
  detailsDigest: string;
  recordRevision: string;
}

export function projectBackpack(
  cards: Card[],
  tasks: Task[],
  records: RecordEntry[],
  entries: TimeEntry[],
  settings: Settings,
  at: string,
  recordSummaries?: ReadonlyMap<string, ProjectedRecordSummary>,
): BackpackSlice {
  const active = cards.filter(card => card.status === '待做' || card.status === '进行中');
  const queueCard = (card: Card): QueueCard => ({ id: card.id, status: card.status as QueueCard['status'],
    fields: { content: card.content, type: card.type, timeboxMinutes: card.timebox_minutes, blocking: card.blocking,
      dueAt: card.due_at, noShrink: card.no_shrink, taskId: card.task_id, project: card.project, tags: card.tags },
    shrinkLevel: card.shrink_level, skipCount: card.skip_count, progressNote: card.progress_note || null });
  const queue = (id: string | null) => active.filter(card => card.task_id === id).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map(queueCard);
  const orderedTasks = [...tasks].sort((a, b) => (a.slot_index ?? Infinity) - (b.slot_index ?? Infinity) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const byId = new Map(cards.map(card => [card.id, card]));
  const itemOf = (card: Card) => {
    const from = card.shrunk_from ? byId.get(card.shrunk_from) : undefined, note = (card as Card & { split_note?: string }).split_note;
    // 拆分出来的：rest 带 split_note；原卡（today）是被拆的那张——有别的卡的 shrunk_from 指向它、它自己不是「已缩小」
    const isRest = !!note && !!from && from.status !== '已缩小', isToday = !isRest && cards.some(c => c.shrunk_from === card.id && (c as Card & { split_note?: string }).split_note);
    return { id: card.id, content: card.content, type: card.type, timeboxMinutes: card.timebox_minutes,
      elapsedMs: refElapsedInTx({ entries, at }, card.id), running: entries.some(entry => entry.card_id === card.id && entry.ended_at === null),
      blocking: card.blocking, dueAt: card.due_at, shrinkLevel: card.shrink_level, project: card.project, tags: card.tags,
      done: card.status === '已完成' ? card.completed_day : null, split: isRest ? 'rest' as const : isToday ? 'today' as const : null, splitFrom: isRest ? note! : null,
      dueDay: card.due_at ? activityDay(card.due_at, settings.dayBoundaryHour) : null };
  };
  const poolTask = (task: Task): PoolTask => {
    const ordered = cards.filter(card => card.task_id === task.id).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const items = ordered.filter(card => card.status === '待做' || card.status === '进行中').map(itemOf);
    const completion = task.status === '已完成' ? (task.completion ?? null) : null;
    const reopenCheck = task.status === '已完成' ? verifyTaskReopen(task, cards, completion?.id ?? null) : null;
    return {
      id: task.id,
      name: task.name,
      track: task.slot,
      defaultProject: task.default_project ?? '未分类',
      items,
      overLimit: task.slot === '主线' && items.length > settings.mainItems,
      betEndsAt: task.bet_ends_at ? task.bet_ends_at.slice(0, 10) : null,
      doneItems: ordered.filter(card => card.status === '已完成').map(itemOf),
      status: task.status,
      completedAt: task.status === '已完成' ? (task.completed_at ?? completion?.at ?? null) : null,
      completionId: completion?.id ?? null,
      reopenMode: task.status === '已完成' ? (completion ? 'snapshot' : 'task_only') : undefined,
      reopenCardIds: completion ? completion.cards.map(c => c.id) : [],
      reopenConflictReason: reopenCheck && !reopenCheck.ok ? reopenCheck.reason : null,
      reopenConflictCardIds: reopenCheck && !reopenCheck.ok ? reopenCheck.conflictCardIds : [],
    };
  };
  const sides = orderedTasks.filter(task => inBackpack(task) && task.slot === '支线').map(poolTask);
  const doneTasks = orderedTasks
    .filter(task => task.status === '已完成')
    .sort((a, b) => {
      const atA = a.completed_at ?? a.completion?.at ?? null;
      const atB = b.completed_at ?? b.completion?.at ?? null;
      if (atA && atB) return atB.localeCompare(atA) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
      if (atA) return -1;
      if (atB) return 1;
      return 0;
    })
    .map(poolTask);
  return {
    pool: {
      mains: orderedTasks.filter(task => inBackpack(task) && task.slot === '主线').map(poolTask), sides,
      parked: orderedTasks.filter(task => task.status === '冷藏').map(task => ({ id: task.id, name: task.name, track: task.slot, itemCount: active.filter(card => card.task_id === task.id).length })),
      doneTasks,
      mainMax: settings.mainTasks, sideMax: settings.sideTasks, mainItems: settings.mainItems, projects: projectOptions(settings.lists.projects),
      knownTags: knownTags([...entries, ...settings.lists.presets, ...cards], settings.lists.tags), excessSideIds: sides.slice(settings.sideTasks).map(task => task.id),
    },
    tasks: orderedTasks.map(task => ({ id: task.id, name: task.name, slot: task.slot, slotIndex: task.slot_index,
      status: task.status, betEndsAt: task.bet_ends_at, openCards: active.filter(card => card.task_id === task.id).length })),
    queue: [...orderedTasks.filter(inBackpack).map(task => ({ taskId: task.id, name: task.name,
      slotLabel: String(task.slot_index).padStart(2, '0'), cards: queue(task.id) })), { taskId: null, name: LOOSE.group, slotLabel: LOOSE.slot, cards: queue(null) }],
    ideas: records.filter(record => record.kind === '想法' && (record.pool === '活跃池' || record.pool === '已转任务'))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
      .map(record => {
        const sum = recordSummaries?.get(record.id);
        return {
          id: record.id, text: record.text, tags: record.tags, needs: record.needs,
          pool: record.pool as '活跃池' | '已转任务', createdAt: record.created_at, lastTouchedAt: record.last_touched_at,
          hasDetails: sum?.hasDetails ?? false,
          recordRevision: sum?.recordRevision ?? computeRecordRevision({
            id: record.id, text: record.text, details_markdown: '', needs: record.needs, tags: record.tags, attachments: record.attachments,
          }),
          attachments: record.attachments,
        };
      }),
    // ADR 0020：已完成的想法单独一组，按完成时间新到旧
    doneIdeas: doneIdeas(records).map(record => {
      const sum = recordSummaries?.get(record.id);
      return {
        id: record.id, text: record.text, tags: record.tags, needs: record.needs,
        completedAt: record.completed_at!, completedBy: record.completed_by ?? { kind: 'manual', agent: null },
        hasDetails: sum?.hasDetails ?? false,
        recordRevision: sum?.recordRevision ?? computeRecordRevision({
          id: record.id, text: record.text, details_markdown: '', needs: record.needs, tags: record.tags, attachments: record.attachments,
        }),
        attachments: record.attachments,
      };
    }),
    coldIdeas: coldOffer(records)
      .map(record => {
        const sum = recordSummaries?.get(record.id);
        return {
          id: record.id, text: record.text, needs: record.needs, coldSince: record.cold_since!,
          tags: record.tags,
          hasDetails: sum?.hasDetails ?? false,
          recordRevision: sum?.recordRevision ?? computeRecordRevision({
            id: record.id, text: record.text, details_markdown: '', needs: record.needs, tags: record.tags, attachments: record.attachments,
          }),
          attachments: record.attachments,
        };
      }),
  };
}
