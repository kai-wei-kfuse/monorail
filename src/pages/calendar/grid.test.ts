import { createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { defaults } from '../../shared/settings';
import { CalendarBoard } from './CalendarBoard';
import { CalendarPage } from './CalendarPage';
import {
  beginBoardDrag,
  CAL_ZOOMS,
  dayHeight,
  dayTotal,
  dragTo,
  endBoardDrag,
  HOUR_PX,
  isoWeek,
  layoutDay,
  moveBoardDrag,
  NEW_BLOCK_MS,
  piece,
  snap,
  stepZoom,
  timeAt,
  viewDays,
  zoomScrollTop,
} from './grid';

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useState: vi.fn((init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, vi.fn()]),
  useRef: vi.fn((init = null) => ({ current: init })),
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
}));

const MIN = 60_000, HOUR = 60 * MIN, STEP = 5 * MIN;
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();   // 2026 年 10 月，本地时间
const iso = (t: number) => new Date(t).toISOString();
const entry = (id: string, s: number, e: number | null) => ({ id, started_at: iso(s), ended_at: e === null ? null : iso(e) });
const DAY = at(28, 4);   // 10 月 28 日（周三）这个活动日，从 04:00 起

describe('viewDays', () => {
  it('日视图是今天，可以往前翻', () => {
    expect(viewDays(at(28, 10), 4, 'day', 0)).toEqual([DAY]);
    expect(viewDays(at(28, 2), 4, 'day', 0)).toEqual([at(27, 4)]);
    expect(viewDays(at(28, 10), 4, 'day', -1)).toEqual([at(27, 4)]);
  });
  it('周视图从周一开始七天', () => {
    const week = viewDays(at(28, 10), 4, 'week', 0);
    expect(week).toHaveLength(7);
    expect(week[0]).toBe(at(26, 4));
    expect(week[6]).toBe(new Date(2026, 10, 1, 4).getTime());
    expect(viewDays(at(28, 10), 4, 'week', 1)[0]).toBe(new Date(2026, 10, 2, 4).getTime());
  });
});

describe('piece 与 timeAt', () => {
  it('缩小时使用原滚动位置保持中心时刻，放大可还原，靠近顶部时不返回负位置', () => {
    const top = 2200, height = 326;
    const reduced = zoomScrollTop(top, height, 1 / 4);
    expect(reduced).toBe(427.75);
    expect((reduced + height / 2) / HOUR_PX).toBe((top + height / 2) / (4 * HOUR_PX));
    expect(zoomScrollTop(reduced, height, 4)).toBe(top);
    expect(zoomScrollTop(0, height, 1 / 4)).toBe(0);
  });
  it('10:00–11:00 在 04:00 起的列里是第 6 小时，高一小时', () => expect(piece(at(28, 10), at(28, 11), DAY)).toEqual({ top: 6 * HOUR_PX, height: HOUR_PX }));
  it('跨过日边界的条目在两天里各画一段', () => {
    expect(piece(at(29, 3), at(29, 5), DAY)).toEqual({ top: 23 * HOUR_PX, height: HOUR_PX });
    expect(piece(at(29, 3), at(29, 5), at(29, 4))).toEqual({ top: 0, height: HOUR_PX });
  });
  it('不在这一天就是 null', () => expect(piece(at(27, 10), at(27, 11), DAY)).toBeNull());
  it('像素换回时刻，夹在这一天之内', () => {
    expect(timeAt(DAY, 6 * HOUR_PX)).toBe(at(28, 10));
    expect(timeAt(DAY, -50)).toBe(DAY);
    expect(timeAt(DAY, 99 * HOUR_PX)).toBe(at(29, 4));
  });
  it('吸附到 5 分钟', () => expect(snap(at(28, 10, 3), STEP)).toBe(at(28, 10, 5)));
  it('按比例放大时，列高、块位置和纵坐标换算按 hourPx 同步缩放', () => {
    const zoomPx = 4 * HOUR_PX;
    expect(dayHeight(DAY, zoomPx)).toBe(24 * zoomPx);
    expect(piece(at(28, 10), at(28, 10, 15), DAY, zoomPx)).toEqual({ top: 6 * zoomPx, height: 0.25 * zoomPx });
    expect(timeAt(DAY, 6 * zoomPx, zoomPx)).toBe(at(28, 10));
    expect(layoutDay([entry('short', at(28, 10), at(28, 10, 15))], DAY, at(28, 15), zoomPx)[0].height).toBe(0.25 * zoomPx);
  });
  it('stepZoom 在 1× ~ 4× 之间切换并夹住边界', () => {
    expect(stepZoom(1, -1)).toBe(1);
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(2, 1)).toBe(3);
    expect(stepZoom(3, 1)).toBe(4);
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(4, -1)).toBe(3);
  });
});

describe('dragTo', () => {
  const now = at(28, 15);
  it('新建：按下和拖到的位置哪个在前都行，结束不晚于现在', () => {
    expect(dragTo({ kind: 'create', t0: at(28, 10) }, at(28, 9, 1), now, STEP)).toEqual({ start: at(28, 9), end: at(28, 10) });
    expect(dragTo({ kind: 'create', t0: at(28, 14) }, at(28, 16), now, STEP)).toEqual({ start: at(28, 14), end: now });
  });
  it('移动：整块平移，碰到现在就整体往前推', () => {
    const d = { kind: 'move' as const, t0: at(28, 10), start: at(28, 10), end: at(28, 11) };
    expect(dragTo(d, at(28, 12, 2), now, STEP)).toEqual({ start: at(28, 12), end: at(28, 13) });
    expect(dragTo(d, at(28, 14, 40), now, STEP)).toEqual({ start: at(28, 14), end: now });
  });
  it('拖开始边：最多拖到结束前一个吸附步长；正在计时的也能拖', () => {
    expect(dragTo({ kind: 'top', t0: at(28, 10), start: at(28, 10), end: at(28, 11) }, at(28, 11, 30), now, STEP)).toEqual({ start: at(28, 10, 55), end: at(28, 11) });
    expect(dragTo({ kind: 'top', t0: at(28, 14), start: at(28, 14), end: null }, at(28, 13, 1), now, STEP)).toEqual({ start: at(28, 13), end: null });
  });
  it('拖结束边：至少留一个吸附步长，不晚于现在', () => {
    const d = { kind: 'bottom' as const, t0: at(28, 11), start: at(28, 10), end: at(28, 11) };
    expect(dragTo(d, at(28, 9), now, STEP)).toEqual({ start: at(28, 10), end: at(28, 10, 5) });
    expect(dragTo(d, at(28, 18), now, STEP)).toEqual({ start: at(28, 10), end: now });
  });
  it('正在计时的条目不能移动', () => expect(() => dragTo({ kind: 'move', t0: at(28, 14), start: at(28, 14), end: null }, at(28, 14, 30), now, STEP)).toThrow());
  it('defaults.calendarSnapMinutes 为唯一默认来源（1 分钟），CalendarBoard 真实 pointer down/move/up 在 1×~4× 比例下均可直接拖出 1 分钟并保留单击新建 30 分钟', () => {
    expect(defaults.calendarSnapMinutes).toBe(1);
    const step1 = defaults.calendarSnapMinutes * MIN;

    for (const zoom of CAL_ZOOMS) {
      const hourPx = HOUR_PX * zoom;
      const oneMinPx = hourPx / 60; // 1× 下仅 0.7667px (< 4px)
      const y1000 = 6 * hourPx; // 10:00 对应像素纵坐标
      const y1001 = y1000 + oneMinPx; // 10:01 对应像素纵坐标

      // 1) 通过 CalendarBoard 真实 DOM pointer 事件链路：在 1×~4× 下直接垂直拖动 1 分钟（dy < 4px）可新建 1 分钟条目
      const onCreate = vi.fn();
      const onChange = vi.fn();
      const onCopy = vi.fn();
      const onOpen = vi.fn();
      const boardTree = CalendarBoard({
        days: [DAY],
        today: DAY,
        now,
        entries: [
          {
            id: 'e1',
            started_at: iso(at(28, 10, 0)),
            ended_at: iso(at(28, 10, 2)),
            description: '短块',
            project: '工作',
            card_id: null,
          },
        ],
        isIdle: () => false,
        showIdle: true,
        colorOf: () => '#00f5a0',
        step: step1,
        boundaryHour: 4,
        zoom,
        onCreate,
        onChange,
        onCopy,
        onOpen,
      });

      let gridEl: ReactElement<Record<string, unknown>> | null = null;
      const walk = (node: ReactNode): void => {
        if (!node) return;
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        if (!isValidElement(node)) return;
        const el = node as ReactElement<Record<string, unknown>>;
        if (el.props.className === 'cal-grid') gridEl = el;
        if (typeof el.props.ref === 'function' && String(el.props.className ?? '').startsWith('cal-col')) {
          (el.props.ref as (dom: unknown) => void)({
            getBoundingClientRect: () => ({ top: 0, right: 500 }),
          });
        }
        walk(el.props.children as ReactNode);
      };
      walk(boardTree);
      expect(gridEl).not.toBeNull();

      const onPointerDown = gridEl!.props.onPointerDown as (e: unknown) => void;
      const onPointerMove = gridEl!.props.onPointerMove as (e: unknown) => void;
      const onPointerUp = gridEl!.props.onPointerUp as (e: unknown) => void;

      const emptyTarget = { closest: () => null, dataset: {} };
      onPointerDown({
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: y1000,
        target: emptyTarget,
        currentTarget: { setPointerCapture: vi.fn() },
      });
      onPointerMove({ clientX: 100, clientY: y1001 });
      onPointerUp({ clientX: 100, clientY: y1001 });

      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(onCreate).toHaveBeenCalledWith(at(28, 10, 0), at(28, 10, 1), 110, y1001 + 10);

      // 2) 原地单击空白处（含极小手抖 < 0.5 分钟）：保持新建 30 分钟默认块语义
      onCreate.mockClear();
      onPointerDown({
        button: 0,
        pointerId: 2,
        clientX: 100,
        clientY: y1000,
        target: emptyTarget,
        currentTarget: { setPointerCapture: vi.fn() },
      });
      onPointerMove({ clientX: 100, clientY: y1000 + oneMinPx * 0.2 });
      onPointerUp({ clientX: 100, clientY: y1000 + oneMinPx * 0.2 });
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(onCreate).toHaveBeenCalledWith(
        at(28, 10, 0),
        at(28, 10, 0) + NEW_BLOCK_MS,
        110,
        y1000 + oneMinPx * 0.2 + 10,
      );

      // 3) 单击已有短块打开弹窗；拖动上下边或整块 1 分钟（dy < 4px）可按 1 分钟调整或移动
      const blockEl = { dataset: { id: 'e1' } };
      onPointerDown({
        button: 0,
        pointerId: 3,
        clientX: 100,
        clientY: y1000,
        target: { closest: () => blockEl, dataset: {} },
        currentTarget: { setPointerCapture: vi.fn() },
      });
      onPointerUp({ clientX: 100, clientY: y1000 });
      expect(onOpen).toHaveBeenCalledWith('e1', 110, y1000 + 10);

      // 拖动 bottom 手柄缩短为 1 分钟（10:02 -> 10:01）
      onPointerDown({
        button: 0,
        pointerId: 4,
        clientX: 100,
        clientY: y1000 + 2 * oneMinPx,
        target: { closest: () => blockEl, dataset: { edge: 'bottom' } },
        currentTarget: { setPointerCapture: vi.fn() },
      });
      onPointerMove({ clientX: 100, clientY: y1001 });
      onPointerUp({ clientX: 100, clientY: y1001 });
      expect(onChange).toHaveBeenCalledWith('e1', at(28, 10, 0), at(28, 10, 1));

      // 拖动整块平移 1 分钟（10:00–10:02 -> 10:01–10:03）
      onChange.mockClear();
      onPointerDown({
        button: 0,
        pointerId: 5,
        clientX: 100,
        clientY: y1000 + oneMinPx,
        ctrlKey: false,
        altKey: false,
        target: { closest: () => blockEl, dataset: {} },
        currentTarget: { setPointerCapture: vi.fn() },
      });
      onPointerMove({ clientX: 100, clientY: y1000 + 2 * oneMinPx });
      onPointerUp({ clientX: 100, clientY: y1000 + 2 * oneMinPx });
      expect(onChange).toHaveBeenCalledWith('e1', at(28, 10, 1), at(28, 10, 3));
    }

    // 4) 纯函数状态机同时验证拖出后再拖回起点（区间为 0 < step）时松手取消，不误建 30 分钟块
    const d0 = beginBoardDrag(null, at(28, 10, 0), 100, 200, step1);
    const d1 = moveBoardDrag(d0, at(28, 10, 2), 100, 201.5, now, step1);
    expect(d1.state.moved).toBe(true);
    const d2 = moveBoardDrag(d1.state, at(28, 10, 0), 100, 200, now, step1);
    expect(endBoardDrag(d2.state, 100, 200, now, step1)).toEqual({ type: 'none' });
  });
});

describe('layoutDay', () => {
  it('互相重叠的分栏并排，不重叠的独占一栏', () => {
    const placed = layoutDay([entry('a', at(28, 10), at(28, 11)), entry('b', at(28, 10, 30), at(28, 11, 30)), entry('c', at(28, 12), at(28, 13))], DAY, at(28, 15));
    const by = Object.fromEntries(placed.map(p => [p.entry.id, [p.col, p.cols]]));
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [0, 1] });
  });
  it('空出来的列会被后面的条目用上', () => {
    const placed = layoutDay([entry('a', at(28, 10), at(28, 12)), entry('b', at(28, 10), at(28, 10, 30)), entry('c', at(28, 11), at(28, 11, 30))], DAY, at(28, 15));
    const by = Object.fromEntries(placed.map(p => [p.entry.id, [p.col, p.cols]]));
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [1, 2] });
  });
  it('正在计时的条目画到现在', () => {
    const [p] = layoutDay([entry('run', at(28, 14), null)], DAY, at(28, 15));
    expect(p.height).toBe(HOUR_PX);
  });
});

describe('dayTotal 与 isoWeek', () => {
  it('当天合计里重叠只算一次，跨日的只算这一天的部分', () => {
    const list = [entry('a', at(28, 10), at(28, 11)), entry('b', at(28, 10, 30), at(28, 11, 30)), entry('night', at(29, 3), at(29, 5))];
    expect(dayTotal(list, DAY, at(29, 6))).toBe(2.5 * HOUR);
  });
  it('2026-10-28 是第 44 周', () => expect(isoWeek(at(28, 10))).toBe(44));
  it('CalendarPage 不再渲染顶部操作提示说明行（.s-desc）', () => {
    const html = renderToStaticMarkup(createElement(CalendarPage, {
      entries: [], projects: [], knownTags: [], boundaryHour: 4, snapMinutes: 1, showIdle: true,
      isIdle: () => false,
      actions: {
        create: vi.fn(), update: vi.fn(), copy: vi.fn(), patch: vi.fn(), continueEntry: vi.fn(),
        favorite: vi.fn(), saveAsCard: vi.fn(), remove: vi.fn(), createProject: vi.fn(), createTag: vi.fn(), setShowIdle: vi.fn(),
      },
    }));
    expect(html).not.toContain('拖空白处新建');
    expect(html).not.toContain('class="s-desc"');
  });
});
