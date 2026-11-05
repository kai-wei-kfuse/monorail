import { expect, it } from 'vitest';
import type { Card } from './card';
import { convert } from '../record/convert';
import { startCard, completeCard, continueCard } from './transitions';
import { splitCard, splitOrigin } from './shrink';
import { baseline } from '../baseline/baseline';

const at = '2026-10-27T00:00:00Z';
function root() { return convert({ id: crypto.randomUUID(), text: '完成原任务', kind: '待办', created_at: at, due_at: null, blocking: false, task_id: null, card_id: null, tags: [], attachments: [] }, 1); }
it('copies task ownership to independent child/continuation cards, preserving completion snapshots', () => {
  const a = { ...root(), due_at: at, blocking: true, task_id: 'main' };
  const completed = completeCard(startCard(a), at, '2026-10-26', '主线', 'done');
  const next = continueCard(completed, crypto.randomUUID(), at, 3);
  expect(next).toMatchObject({ status: '待做', continued_from: completed.id, progress_note: 'done', blocking: true, task_id: 'main', due_at: at });
  expect(next.completed_day).toBe(null);
  expect(baseline([{ ...completed, task_id: 'side-now' }], '2026-10-26', true)).toEqual({ main: true, side: false });
  expect(baseline([completed], '2026-10-26', false).main).toBe(null);
  const child = { ...startCard(a), id: 'child', shrunk_from: a.id, shrink_level: 1 };
  expect(() => continueCard(completeCard(child, at, '2026-10-26', '主线', ''), crypto.randomUUID(), at, 4)).toThrow('不能生成续卡');
});

// ---------- 0.3.1 拆分（ADR 0021 第 4 条，已定 50、54） ----------
const box = () => ({ ...root(), type: '时间盒卡' as const, timebox_minutes: 120, status: '进行中' as const, order: 3 });
const split = (over: Partial<Parameters<typeof splitCard>[1]> = {}) => ({ id: 'rest', at, order: 3.5, todayContent: '只读 4.1–4.3', restContent: '4.4 以后',
  restMinutes: 25, todayGoal: 60, minutesToday: 18, minutesTotal: 18, ...over });
it('时间盒拆分：原卡 id 不变、改内容和时长；rest 是新卡、带 split_note；两份加起来等于今天的量', () => {
  const card = box(), r = splitCard(card, split());
  expect(r.today).toMatchObject({ id: card.id, content: '只读 4.1–4.3', timebox_minutes: 95, shrink_level: 1, status: '进行中', shrunk_from: null });
  expect(r.rest).toMatchObject({ id: 'rest', content: '4.4 以后', timebox_minutes: 25, status: '待做', shrunk_from: card.id, shrink_level: 1, split_note: '完成原任务', order: 3.5 });
  expect(r.todayMinutes).toBe(35);
});
it('时间盒拆分的约束：剩下至少 5 分钟、今天这份不少于今天已计、不少于总已计', () => {
  expect(() => splitCard(box(), split({ restMinutes: 4 }))).toThrow('至少 5');
  expect(() => splitCard(box(), split({ restMinutes: 45, minutesToday: 18 }))).toThrow('今天已经计');
  expect(() => splitCard(box(), split({ restMinutes: 25, minutesTotal: 100 }))).toThrow('已经计的时间');
  expect(() => splitCard(box(), split({ todayContent: ' ' }))).toThrow('两句都要写');
});
it('结果卡拆分：两张都是结果卡、不分时间；不设级数上限', () => {
  let card: Card = { ...root(), status: '进行中' };
  for (let i = 0; i < 6; i++) card = splitCard(card, split({ id: `r${i}`, restMinutes: null, todayGoal: null })).today;
  expect(card).toMatchObject({ shrink_level: 6, type: '结果卡', timebox_minutes: null });
});
it('鼠标提示只在父卡不是「已缩小」时读 split_note（0.3.0 缩小会把它复制给子卡）', () => {
  const card = box(), r = splitCard(card, split());
  expect(splitOrigin(r.rest, r.today)).toBe('完成原任务');
  expect(splitOrigin(r.rest, { ...r.today, status: '已缩小' })).toBeNull();
});
