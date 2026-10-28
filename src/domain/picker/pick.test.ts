import { expect, it } from 'vitest';
import { pick, isCandidate } from './pick';
import type { PickInput } from './pick';
import { convert } from '../record/convert';
import type { Task } from '../task/task';
const at = '2026-10-27T10:00:00Z';
const task = (id: string, slot: Task['slot']): Task => ({ id, name: id, slot, slot_index: slot === '主线' ? 1 : 2, status: '进行中', created_at: at, bet_ends_at: null, default_project: null });
function card(id: string, taskId: string | null = null) { return { ...convert({ id: crypto.randomUUID(), text: id, kind: '待办', created_at: at, due_at: null, blocking: false, task_id: taskId, card_id: null, tags: [], attachments: [] }, 1), id }; }
function input(): PickInput { return { cards: [], tasks: [task('main', '主线'), task('side', '支线')], day: '2026-10-27', at, dueSoonHours: 24, excluded: [], review: null, random: 0, mainWeight: 1.5 }; }
it('A3 ranks blockers before review, review before deadline, then main and side', () => {
  const a = { ...input(), cards: [card('main', 'main'), card('side', 'side'), { ...card('due'), due_at: at }, { ...card('block'), blocking: true }], review: { period: '2026-W44', resumeStep: 'recap', betDue: false } };
  expect(pick(a)).toMatchObject({ kind: 'task', card: { id: 'block' } });
  expect(pick({ ...a, excluded: ['block'] })).toMatchObject({ kind: 'review' });
  expect(pick({ ...a, review: null, excluded: ['block'] })).toMatchObject({ kind: 'task', card: { id: 'due' } });
  expect(pick({ ...a, review: null, excluded: ['block', 'due'] })).toMatchObject({ card: { id: 'main' } });
  expect(pick({ ...a, review: null, excluded: ['block', 'due', 'main'] })).toMatchObject({ card: { id: 'side' } });
});
it('A3 excludes inactive tasks and terminal card states but permits loose tasks', () => {
  const tasks = [task('main', '主线'), { ...task('cold', '支线'), status: '冷藏' as const }];
  for (const status of ['已完成', '已缩小', '已放弃'] as const) expect(isCandidate({ ...card('x', 'main'), status }, tasks)).toBe(false);
  expect(isCandidate(card('x', 'cold'), tasks)).toBe(false); expect(isCandidate(card('loose'), [])).toBe(true);
});
it('continues a new round after all candidates were skipped and falls back to main when side is absent', () => {
  const a = { ...input(), cards: [card('a', 'main')], excluded: ['a'] };
  expect(pick(a)).toMatchObject({ card: { id: 'a' }, resetRound: true });
  const completed = { ...card('done', 'main'), status: '已完成' as const, completed_day: a.day, completed_track: '主线' as const };
  expect(pick({ ...a, cards: [...a.cards, completed], excluded: [] })).toMatchObject({ card: { id: 'a' } });
});
it('uses guide cards only when no actionable task or review is available', () => {
  expect(pick({ ...input(), tasks: [] })).toMatchObject({ kind: 'guide', guide: 'firstTask' });
  expect(pick({ ...input(), tasks: [task('side', '支线')] })).toMatchObject({ guide: 'setMain' });
  expect(pick(input())).toMatchObject({ guide: 'splitMain' });
  expect(pick({ ...input(), cards: [{ ...card('done', 'main'), status: '已完成' }] })).toMatchObject({ guide: 'allDone' });
  expect(pick({ ...input(), tasks: [], cards: [card('loose')] })).toMatchObject({ kind: 'task' });
});
it('orders equal priority by deadline then queue position then stable id', () => {
  const a = { ...input(), cards: [{ ...card('z'), blocking: true }, { ...card('b'), blocking: true, due_at: at }, { ...card('a'), blocking: true, due_at: at }] };
  expect(pick(a)).toMatchObject({ card: { id: 'a' } });
});
