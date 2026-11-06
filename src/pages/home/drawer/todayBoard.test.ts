import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { TodayBoard } from './TodayBoard';
import type { PlanBoard, PlanRow } from '../../../store/planSlice';

// 今日任务板（UI 规范 §11.15）：带过来的逐项可去勾（G7 审核 S2）；插入中〔抽一张〕灰掉；正在计那一行按秒补
const row = (id: string, more: Partial<PlanRow> = {}): PlanRow => ({ cardId: id, title: `卡 ${id}`, taskName: null, track: '主线', priority: '普通', type: '时间盒卡',
  todayMinutes: 60, minutesToday: 10, achieved: false, running: false, carried: false, dueThatDay: false, ...more });
const board = (rows: PlanRow[], more: Partial<PlanBoard> = {}): PlanBoard => ({ day: '2026-11-06', rows, achieved: 0, total: rows.length, skipUntilPlanned: false,
  carryPending: false, carriedFrom: null, drawable: rows.map(r => r.cardId), ...more });
const render = (b: PlanBoard, extra: Partial<Parameters<typeof TodayBoard>[0]> = {}) => renderToStaticMarkup(createElement(TodayBoard, {
  day: 'today', board: b, drawable: b.drawable.length, inserting: false, runningMs: 0,
  onDay: vi.fn(), onStart: vi.fn(), onRemove: vi.fn(), onDraw: vi.fn(), onCarry: vi.fn(), ...extra }));

it('带过来的：每一项一个勾（默认勾着），〔全部去掉〕〔确认〕', () => {
  const html = render(board([row('a', { carried: true }), row('b', { carried: true }), row('c')], { carryPending: true, carriedFrom: '2026-11-05' }));
  expect(html.match(/type="checkbox"/g)?.length).toBe(2);
  expect(html).toContain('checked=""');
  expect(html).toContain('全部去掉'); expect(html).toContain('确认');
  expect(html).toContain('从 11/05 带过来 2 项');
});
it('插入中〔抽一张〕灰掉；正在计那一行按秒补到读数里', () => {
  expect(render(board([row('a')]), { inserting: true })).toMatch(/class="bp-draw" disabled=""/);
  const html = render(board([row('a', { running: true, minutesToday: 10 })]), { runningMs: 5 * 60_000 });
  expect(html).toContain('0:15 / 1:00');
});
