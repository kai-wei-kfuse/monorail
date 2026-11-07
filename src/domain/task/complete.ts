import type { Card } from '../card/card';
import type { Task, TaskCompletionCardSnapshot } from './task';
import { inBackpack } from './task';

export interface CompleteTaskPlan {
  task: Task;
  track: '主线' | '支线';
  affectedCardIds: string[];
}

export function completeTaskMeta(
  task: Task,
  cards: readonly Card[],
  completionId: string,
  at: string,
  completedDay: string,
): CompleteTaskPlan {
  if (!inBackpack(task)) throw new Error('只能完成背包中进行中的任务');
  if (!completedDay) throw new Error('缺少完成活动日');
  const members = cards.filter(card => card.task_id === task.id);
  const memberIds = members.map(card => card.id).sort((a, b) => a.localeCompare(b));
  const snapshots: TaskCompletionCardSnapshot[] = members
    .filter((card): card is Card & { status: '待做' | '进行中' } => card.status === '待做' || card.status === '进行中')
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map(card => ({
      id: card.id,
      before: {
        status: card.status,
        completed_at: card.completed_at,
        completed_day: card.completed_day,
        completed_track: card.completed_track,
      },
    }));
  const completedTask: Task = {
    ...task,
    status: '已完成',
    slot_index: null,
    completed_at: at,
    completion: {
      id: completionId,
      at,
      completed_day: completedDay,
      task_slot: task.slot,
      member_ids: memberIds,
      cards: snapshots,
    },
  };
  return {
    task: completedTask,
    track: task.slot,
    affectedCardIds: snapshots.map(item => item.id),
  };
}

export type ReopenVerifyFailureReason =
  | 'SNAPSHOT_REQUIRED'
  | 'COMPLETION_ID_MISMATCH'
  | 'NO_SNAPSHOT'
  | 'SLOT_CHANGED'
  | 'MEMBER_CHANGED'
  | 'CARD_STATE_CHANGED';

export type ReopenVerifyResult =
  | { ok: true; mode: 'snapshot' | 'task_only'; snapshots: TaskCompletionCardSnapshot[] }
  | { ok: false; reason: ReopenVerifyFailureReason; conflictCardIds: string[] };

export function verifyTaskReopen(task: Task, cards: readonly Card[], completionId: string | null): ReopenVerifyResult {
  if (task.status !== '已完成') throw new Error('只能重新打开已完成的任务');
  const snapshot = task.completion ?? null;
  if (!snapshot) {
    if (completionId !== null) return { ok: false, reason: 'NO_SNAPSHOT', conflictCardIds: [] };
    return { ok: true, mode: 'task_only', snapshots: [] };
  }
  if (completionId === null) return { ok: false, reason: 'SNAPSHOT_REQUIRED', conflictCardIds: [] };
  if (completionId !== snapshot.id) return { ok: false, reason: 'COMPLETION_ID_MISMATCH', conflictCardIds: [] };
  if (task.slot !== snapshot.task_slot) return { ok: false, reason: 'SLOT_CHANGED', conflictCardIds: [] };

  const currentMembers = cards.filter(card => card.task_id === task.id);
  const currentIds = currentMembers.map(card => card.id).sort((a, b) => a.localeCompare(b));
  const expectedIds = [...snapshot.member_ids].sort((a, b) => a.localeCompare(b));
  if (currentIds.length !== expectedIds.length || currentIds.some((id, idx) => id !== expectedIds[idx])) {
    const currentSet = new Set(currentIds);
    const expectedSet = new Set(expectedIds);
    const diff = [
      ...expectedIds.filter(id => !currentSet.has(id)),
      ...currentIds.filter(id => !expectedSet.has(id)),
    ];
    return { ok: false, reason: 'MEMBER_CHANGED', conflictCardIds: Array.from(new Set(diff)) };
  }

  if (!snapshot.completed_day) {
    return {
      ok: false,
      reason: 'CARD_STATE_CHANGED',
      conflictCardIds: snapshot.cards.map(item => item.id),
    };
  }
  const byId = new Map(currentMembers.map(card => [card.id, card]));
  const expectedDay = snapshot.completed_day;
  const conflicts: string[] = [];
  for (const item of snapshot.cards) {
    const card = byId.get(item.id);
    if (
      !card ||
      card.task_id !== task.id ||
      card.status !== '已完成' ||
      card.completed_at !== snapshot.at ||
      card.completed_track !== snapshot.task_slot ||
      card.completed_day === null ||
      card.completed_day !== expectedDay
    ) {
      conflicts.push(item.id);
    }
  }
  if (conflicts.length > 0) {
    return { ok: false, reason: 'CARD_STATE_CHANGED', conflictCardIds: conflicts };
  }
  return { ok: true, mode: 'snapshot', snapshots: snapshot.cards };
}

export function reopenTaskMeta(originalTask: Task, placedInBackpack: Task): Task {
  return {
    ...placedInBackpack,
    bet_ends_at: originalTask.bet_ends_at,
    completed_at: null,
    completion: null,
  };
}
