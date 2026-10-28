import { describe, expect, it } from 'vitest';
import { dayTotal, dragTo, HOUR_PX, isoWeek, layoutDay, piece, snap, timeAt, viewDays } from './grid';

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
});
