import { expect, it } from 'vitest';
import { convert } from '../record/convert';
import { startCard, completeCard, abandonCard, continueCard } from './transitions';
import { shrinkCard, restoreParent } from './shrink';
import { baseline } from '../baseline/baseline';

const at = '2026-10-27T00:00:00Z';
function root() { return convert({ id: crypto.randomUUID(), text: '完成原任务', kind: '待办', created_at: at, due_at: null, blocking: false, task_id: null, card_id: null, tags: [], attachments: [] }, 1); }
const input = (level = 2) => ({ id: crypto.randomUUID(), at, content: '小一点', type: '结果卡' as const, minutes: null, order: 2, maxLevel: level });
it('A6 restores only the immediate parent through two shrink levels', () => {
  const a = root(), ab = shrinkCard(startCard(a), input()), bc = shrinkCard(ab.child, input());
  expect(ab.parent.content).toBe(a.content); expect(bc.child.shrink_level).toBe(2);
  const completedC = completeCard(bc.child, at, '2026-10-27', '支线', 'C进度');
  const restoredB = restoreParent(completedC, bc.parent, completedC.progress_note);
  expect(restoredB).toMatchObject({ status: '待做', progress_note: 'C进度' });
  expect(ab.parent.status).toBe('已缩小');
  const completedB = completeCard(startCard(restoredB), at, '2026-10-27', '支线', 'B进度');
  expect(restoreParent(completedB, ab.parent, completedB.progress_note)).toMatchObject({ status: '待做', progress_note: 'B进度' });
});
it('A6 allows PASS on a leaf and restores its parent, never PASS on an already-shrunk card', () => {
  const ab = shrinkCard(root(), input()), bc = shrinkCard(ab.child, input());
  expect(() => abandonCard(ab.parent)).toThrow('先处理');
  const restoredB = restoreParent(abandonCard(bc.child), bc.parent, '');
  expect(restoredB.status).toBe('待做');
  expect(restoreParent(abandonCard(restoredB), ab.parent, '').status).toBe('待做');
});
it('keeps existing deep cards but obeys a lowered limit for new shrink operations', () => {
  const ab = shrinkCard(root(), input()), bc = shrinkCard(ab.child, input());
  expect(() => shrinkCard(bc.child, input(1))).toThrow('缩小限制');
  expect(bc.child.shrink_level).toBe(2);
});
it('copies task ownership to independent child/continuation cards, preserving completion snapshots', () => {
  const a = { ...root(), due_at: at, blocking: true, task_id: 'main' };
  const completed = completeCard(startCard(a), at, '2026-10-26', '主线', 'done');
  const next = continueCard(completed, crypto.randomUUID(), at, 3);
  expect(next).toMatchObject({ status: '待做', continued_from: completed.id, progress_note: 'done', blocking: true, task_id: 'main', due_at: at });
  expect(next.completed_day).toBe(null);
  expect(baseline([{ ...completed, task_id: 'side-now' }], '2026-10-26', true)).toEqual({ main: true, side: false });
  expect(baseline([completed], '2026-10-26', false).main).toBe(null);
  const child = shrinkCard(startCard(a), input()).child;
  expect(() => continueCard(completeCard(child, at, '2026-10-26', '主线', ''), crypto.randomUUID(), at, 4)).toThrow('不能生成续卡');
});
