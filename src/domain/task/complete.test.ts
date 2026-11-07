import { describe, expect, it } from 'vitest';
import type { Card } from '../card/card';
import { createCard } from '../card/edit';
import { completeCardItem, reopenCardItem, restoreCardFromSnapshot } from '../card/transitions';
import { putInBackpack } from './backpack';
import { completeTaskMeta, reopenTaskMeta, verifyTaskReopen } from './complete';
import type { Task } from './task';
import { defaults } from '../../shared/settings';

const createdAt = '2026-11-01T09:00:00.000+08:00';
const completedAt = '2026-11-07T15:30:00.000+08:00';
const completionId = '019a5dc0-1111-7000-8000-000000000001';

const baseTask: Task = {
  id: 't-main',
  name: '完成 0.3.2 里程碑',
  slot: '主线',
  slot_index: 1,
  status: '进行中',
  created_at: createdAt,
  bet_ends_at: '2026-11-20T00:00:00.000+08:00',
  default_project: '工作',
};

function makeCard(id: string, order: number, overrides: Partial<Card> = {}): Card {
  const card = createCard(id, {
    content: `事项 ${id}`,
    type: '结果卡',
    timeboxMinutes: null,
    taskId: baseTask.id,
    blocking: false,
    noShrink: false,
    dueAt: null,
    project: '工作',
    tags: ['032'],
  }, createdAt, order);
  return { ...card, ...overrides };
}

describe('P1: Card single-item transitions & Task completion/reopen pure domain rules', () => {
  it('completeCardItem allows 待做 and 进行中, preserving existing progress_note when note is omitted', () => {
    const todo = makeCard('c-1', 1, { status: '待做', progress_note: '原笔记' });
    const running = makeCard('c-2', 2, { status: '进行中', progress_note: '进行中笔记' });
    const done1 = completeCardItem(todo, completedAt, '2026-11-07', '主线');
    expect(done1).toMatchObject({
      status: '已完成',
      completed_at: completedAt,
      completed_day: '2026-11-07',
      completed_track: '主线',
      progress_note: '原笔记',
    });
    const done2 = completeCardItem(running, completedAt, '2026-11-07', '主线', '新完成笔记');
    expect(done2).toMatchObject({
      status: '已完成',
      completed_at: completedAt,
      completed_day: '2026-11-07',
      completed_track: '主线',
      progress_note: '新完成笔记',
    });
    expect(() => completeCardItem(done1, completedAt, '2026-11-07', '主线')).toThrow('只有待做或进行中的卡可以完成');
  });

  it('reopenCardItem restores 已完成 card to 待做 and clears completion fields while preserving note/order/project/tags', () => {
    const done = completeCardItem(
      makeCard('c-1', 3, { status: '待做', progress_note: '写完初稿', project: '研发', tags: ['核心'] }),
      completedAt,
      '2026-11-07',
      '主线',
    );
    const reopened = reopenCardItem(done);
    expect(reopened).toMatchObject({
      status: '待做',
      completed_at: null,
      completed_day: null,
      completed_track: null,
      progress_note: '写完初稿',
      order: 3,
      project: '研发',
      tags: ['核心'],
    });
    expect(() => reopenCardItem(reopened)).toThrow('只有已完成的卡可以取消完成');
  });

  it('completeTaskMeta snapshots only 待做/进行中 cards, excludes 已完成/已缩小/已放弃 from batch, and preserves bet_ends_at', () => {
    const earlierDone = makeCard('c-done', 1, {
      status: '已完成',
      completed_at: '2026-11-05T10:00:00.000+08:00',
      completed_day: '2026-11-05',
      completed_track: '主线',
      progress_note: '先前完成',
    });
    const activeTodo = makeCard('c-todo', 2, { status: '待做', progress_note: '草稿' });
    const activeRunning = makeCard('c-run', 3, { status: '进行中', progress_note: '半成品' });
    const shrunkOld = makeCard('c-shrunk', 4, { status: '已缩小' });
    const abandoned = makeCard('c-pass', 5, { status: '已放弃' });

    const plan = completeTaskMeta(baseTask, [earlierDone, activeTodo, activeRunning, shrunkOld, abandoned], completionId, completedAt, '2026-11-07');
    expect(plan.track).toBe('主线');
    expect(plan.affectedCardIds).toEqual(['c-todo', 'c-run']);
    expect(plan.task).toMatchObject({
      status: '已完成',
      slot: '主线',
      slot_index: null,
      bet_ends_at: '2026-11-20T00:00:00.000+08:00',
      completed_at: completedAt,
      completion: {
        id: completionId,
        at: completedAt,
        task_slot: '主线',
        member_ids: ['c-done', 'c-pass', 'c-run', 'c-shrunk', 'c-todo'],
        cards: [
          { id: 'c-todo', before: { status: '待做', completed_at: null, completed_day: null, completed_track: null } },
          { id: 'c-run', before: { status: '进行中', completed_at: null, completed_day: null, completed_track: null } },
        ],
      },
    });

    const afterCards = [
      earlierDone,
      completeCardItem(activeTodo, completedAt, '2026-11-07', plan.track),
      completeCardItem(activeRunning, completedAt, '2026-11-07', plan.track),
      shrunkOld,
      abandoned,
    ];

    const verified = verifyTaskReopen(plan.task, afterCards, completionId);
    expect(verified).toEqual({
      ok: true,
      mode: 'snapshot',
      snapshots: plan.task.completion!.cards,
    });

    // Restoring from snapshot converts both 待做 and 进行中 back to 待做 (never restarts timer)
    const restoredCards = afterCards.map(c => {
      const snap = plan.task.completion!.cards.find(s => s.id === c.id);
      return snap ? restoreCardFromSnapshot(c, snap.before) : c;
    });
    expect(restoredCards.find(c => c.id === 'c-done')?.status).toBe('已完成');
    expect(restoredCards.find(c => c.id === 'c-todo')?.status).toBe('待做');
    expect(restoredCards.find(c => c.id === 'c-run')?.status).toBe('待做');
    expect(restoredCards.find(c => c.id === 'c-shrunk')?.status).toBe('已缩小');
    expect(restoredCards.find(c => c.id === 'c-pass')?.status).toBe('已放弃');

    const placed = putInBackpack(plan.task, '主线', [], defaults, '2026-11-08T09:00:00.000+08:00');
    const reopenedTask = reopenTaskMeta(plan.task, placed);
    expect(reopenedTask).toMatchObject({
      status: '进行中',
      slot: '主线',
      slot_index: 1,
      bet_ends_at: '2026-11-20T00:00:00.000+08:00',
      completed_at: null,
      completion: null,
    });
  });

  it('supports empty active set (main task whose items were all completed individually) and task_only reopen when completion is null', () => {
    const done1 = makeCard('c-1', 1, {
      status: '已完成',
      completed_at: '2026-11-06T10:00:00.000+08:00',
      completed_day: '2026-11-06',
      completed_track: '主线',
    });
    const plan = completeTaskMeta(baseTask, [done1], completionId, completedAt, '2026-11-07');
    expect(plan.affectedCardIds).toEqual([]);
    expect(plan.task.completion?.cards).toEqual([]);
    expect(verifyTaskReopen(plan.task, [done1], completionId)).toEqual({
      ok: true,
      mode: 'snapshot',
      snapshots: [],
    });

    const autoCompletedSide: Task = {
      ...baseTask,
      id: 't-side',
      slot: '支线',
      slot_index: null,
      status: '已完成',
      bet_ends_at: null,
      completed_at: completedAt,
      completion: null,
    };
    expect(verifyTaskReopen(autoCompletedSide, [{ ...done1, task_id: 't-side' }], null)).toEqual({
      ok: true,
      mode: 'task_only',
      snapshots: [],
    });
    expect(verifyTaskReopen(autoCompletedSide, [{ ...done1, task_id: 't-side' }], completionId)).toEqual({
      ok: false,
      reason: 'NO_SNAPSHOT',
      conflictCardIds: [],
    });
  });

  it('rejects verifyTaskReopen on missing/mismatched completionId, missing completed_day, slot change, member change, or card state change', () => {
    const c1 = makeCard('c-1', 1, { status: '待做' });
    const plan = completeTaskMeta(baseTask, [c1], completionId, completedAt, '2026-11-07');
    const doneC1 = completeCardItem(c1, completedAt, '2026-11-07', '主线');

    const withoutDay = { ...plan.task.completion! };
    delete withoutDay.completed_day;
    expect(verifyTaskReopen({ ...plan.task, completion: withoutDay }, [doneC1], completionId)).toEqual({
      ok: false,
      reason: 'CARD_STATE_CHANGED',
      conflictCardIds: ['c-1'],
    });

    expect(verifyTaskReopen(plan.task, [doneC1], null)).toEqual({
      ok: false,
      reason: 'SNAPSHOT_REQUIRED',
      conflictCardIds: [],
    });
    expect(verifyTaskReopen(plan.task, [doneC1], '019a5dc0-9999-7000-8000-000000000099')).toEqual({
      ok: false,
      reason: 'COMPLETION_ID_MISMATCH',
      conflictCardIds: [],
    });
    expect(verifyTaskReopen({ ...plan.task, slot: '支线' }, [doneC1], completionId)).toEqual({
      ok: false,
      reason: 'SLOT_CHANGED',
      conflictCardIds: [],
    });
    expect(verifyTaskReopen(plan.task, [doneC1, makeCard('c-extra', 2)], completionId)).toEqual({
      ok: false,
      reason: 'MEMBER_CHANGED',
      conflictCardIds: ['c-extra'],
    });
    expect(verifyTaskReopen(plan.task, [{ ...doneC1, status: '待做', completed_at: null }], completionId)).toEqual({
      ok: false,
      reason: 'CARD_STATE_CHANGED',
      conflictCardIds: ['c-1'],
    });
    expect(verifyTaskReopen(plan.task, [{ ...doneC1, completed_day: '2026-11-08' }], completionId)).toEqual({
      ok: false,
      reason: 'CARD_STATE_CHANGED',
      conflictCardIds: ['c-1'],
    });
  });
});
