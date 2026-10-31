import { createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { dayLabel, groupKey, listDays, matchesQuery, overlapping } from './listGroups';
import type { ListEntry } from './listGroups';
import { EntryRow, duration } from './EntryRow';
import type { RowContext } from './EntryRow';

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useState: vi.fn((init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, vi.fn()]),
  useRef: vi.fn((init = null) => ({ current: init })),
  useId: vi.fn(() => 'id-mock'),
  useEffect: vi.fn(),
}));

function walk(node: ReactNode, visit: (el: ReactElement<Record<string, unknown>>) => void): void {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach(child => walk(child, visit)); return; }
  if (!isValidElement(node)) return;
  const el = node as ReactElement<Record<string, unknown>>;
  if (typeof el.type === 'function') {
    walk((el.type as (props: Record<string, unknown>) => ReactNode)(el.props), visit);
    return;
  }
  visit(el);
  walk(el.props.children as ReactNode, visit);
}

const MIN = 60_000;
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();   // 2026 年 10 月，本地时间
const iso = (t: number) => new Date(t).toISOString();
let n = 0;
const entry = (s: number, e: number | null, description: string, extra: Partial<ListEntry> = {}): ListEntry =>
  ({ id: `e${++n}`, started_at: iso(s), ended_at: e === null ? null : iso(e), description, project: '学习', tags: [], card_id: null, ...extra });
const isIdle = (e: ListEntry) => e.project === '待机';
const opts = { now: at(28, 15), boundaryHour: 4, days: 7, showIdle: false, query: '', isIdle };

describe('listDays', () => {
  const list = [
    entry(at(28, 9), at(28, 10), '学 408', { tags: ['408'] }),
    entry(at(28, 11), at(28, 11, 30), '学 408', { tags: ['408'] }),
    entry(at(28, 10, 30), at(28, 11, 15), '回邮件', { project: '工作' }),
    entry(at(28, 14), null, '写周报', { project: '工作' }),
    entry(at(28, 12), at(28, 14), '待机', { project: '待机' }),
    entry(at(28, 2), at(28, 3), '熬夜', { project: '娱乐' }),
    entry(at(20, 10), at(20, 11), '太早了'),
  ];
  const days = listDays(list, opts);
  it('按活动日分组，新的在上；凌晨 2 点算前一天；超出 7 天的不显示', () => {
    expect(days.map(d => d.day)).toEqual([at(28, 4), at(27, 4)]);
    expect(days[1].groups.map(g => g.entries[0].description)).toEqual(['熬夜']);
  });
  it('同一天相同的条目合成一组，组按最晚开始排', () => {
    expect(days[0].groups.map(g => [g.entries[0].description, g.entries.length])).toEqual([['写周报', 1], ['学 408', 2], ['回邮件', 1]]);
    const study = days[0].groups[1];
    expect([study.first, study.last, study.total]).toEqual([at(28, 9), at(28, 11, 30), 90 * MIN]);
    expect(days[0].groups[0].last).toBeNull();
  });
  // 9:00–10:00、10:30–11:30（回邮件和第二段学 408 重叠，合成一段）、14:00–15:00（写周报计到现在）
  it('当天合计里重叠只算一次，默认不算待机', () => expect(days[0].total).toBe(180 * MIN));
  it('跨过日边界的条目，当天合计只算到下一个日边界', () => {
    const night = listDays([entry(at(27, 23), at(28, 7), '睡前看书', { project: '生活' })], { ...opts, now: at(28, 8) });
    expect(night[0].total).toBe(5 * 60 * MIN);
    expect(night[0].groups[0].total).toBe(8 * 60 * MIN);
  });
  it('勾上显示待机后，待机也列出来', () => expect(listDays(list, { ...opts, showIdle: true })[0].groups.some(g => g.entries[0].project === '待机')).toBe(true));
  it('按描述、项目、#标签筛选', () => {
    expect(listDays(list, { ...opts, query: '#408' })[0].groups.map(g => g.entries[0].description)).toEqual(['学 408']);
    expect(listDays(list, { ...opts, query: '工作' })[0].groups).toHaveLength(2);
  });
});

describe('其他', () => {
  it('标签顺序不同也算同一组；卡不同不算', () => {
    expect(groupKey(entry(0, 1, 'a', { tags: ['x', 'y'] }))).toBe(groupKey(entry(0, 1, 'a', { tags: ['y', 'x'] })));
    expect(groupKey(entry(0, 1, 'a', { card_id: 'c1' }))).not.toBe(groupKey(entry(0, 1, 'a')));
  });
  it('和别的条目重叠的标并行，待机不算', () => {
    const a = entry(at(28, 10), at(28, 11), 'a'), b = entry(at(28, 10, 30), at(28, 12), 'b'), c = entry(at(28, 13), at(28, 14), 'c');
    const idle = entry(at(28, 13), at(28, 13, 30), '待机', { project: '待机' });
    expect([...overlapping([a, b, c, idle], at(28, 15), isIdle)].sort()).toEqual([a.id, b.id].sort());
  });
  it('筛选不分大小写', () => expect(matchesQuery(entry(0, 1, 'Python 练习'), 'python')).toBe(true));
  it('组标题：今天、昨天、日期加星期', () => {
    expect(dayLabel(at(28, 4), at(28, 4))).toBe('今天');
    expect(dayLabel(at(27, 4), at(28, 4))).toBe('昨天');
    expect(dayLabel(at(25, 4), at(28, 4))).toBe('10 月 25 日 周日');
  });
  it('EntryRow 使用与首页一致的 flat 简约分类与标签选择器，且时长不到 1 小时省略 00:', async () => {
    const ctx: RowContext = {
      now: at(28, 10, 45),
      projects: [{ name: '学习', color: '#1aa3ff' }],
      knownTags: ['408'],
      isIdle,
      overlaps: new Set(),
      actions: {
        patch: vi.fn(), setStart: vi.fn(), setEnd: vi.fn(), setDuration: vi.fn(),
        continueEntry: vi.fn(), copy: vi.fn(), favorite: vi.fn(), saveAsCard: vi.fn(),
        remove: vi.fn(), createProject: vi.fn(), createTag: vi.fn(),
      },
    };
    const html = renderToStaticMarkup(createElement(EntryRow, {
      e: entry(at(28, 10), at(28, 10, 45), '学 408', { tags: ['408'] }),
      ctx,
    }));
    expect(html).toContain('class="combo flat"');
    expect(html).toContain('class="tagpick flat"');
    expect(html).not.toContain('class="combo sm"');
    expect(duration(45 * MIN)).toBe('45:00');
    expect(duration(75 * MIN)).toBe('01:15:00');

    // 验证时长输入格（Cell）未修改直接失焦不调用 setDuration，改为 45:01 时才提交
    const { useState } = await import('react');
    // EntryRow 内 Cell 调用顺序：描述(1)、ProjectPicker(3)、TagPicker(3)、开始(1)、结束(1)、时长(1)
    vi.mocked(useState)
      .mockReturnValueOnce([null, vi.fn()])
      .mockReturnValueOnce([null, vi.fn()]).mockReturnValueOnce([-1, vi.fn()]).mockReturnValueOnce(['', vi.fn()])
      .mockReturnValueOnce([null, vi.fn()]).mockReturnValueOnce([-1, vi.fn()]).mockReturnValueOnce(['', vi.fn()])
      .mockReturnValueOnce([null, vi.fn()])
      .mockReturnValueOnce([null, vi.fn()])
      .mockReturnValueOnce(['45:00', vi.fn()]);
    let durBlur: (() => void) | null = null;
    walk(createElement(EntryRow, { e: entry(at(28, 10), at(28, 10, 45), '学 408'), ctx }), el => {
      if (el.type === 'input' && el.props['aria-label'] === '时长') durBlur = el.props.onBlur as () => void;
    });
    durBlur!();
    expect(ctx.actions.setDuration).not.toHaveBeenCalled();

    vi.mocked(useState)
      .mockReturnValueOnce([null, vi.fn()])
      .mockReturnValueOnce([null, vi.fn()]).mockReturnValueOnce([-1, vi.fn()]).mockReturnValueOnce(['', vi.fn()])
      .mockReturnValueOnce([null, vi.fn()]).mockReturnValueOnce([-1, vi.fn()]).mockReturnValueOnce(['', vi.fn()])
      .mockReturnValueOnce([null, vi.fn()])
      .mockReturnValueOnce([null, vi.fn()])
      .mockReturnValueOnce(['45:01', vi.fn()]);
    walk(createElement(EntryRow, { e: entry(at(28, 10), at(28, 10, 45), '学 408', { id: 'e-dur' }), ctx }), el => {
      if (el.type === 'input' && el.props['aria-label'] === '时长') durBlur = el.props.onBlur as () => void;
    });
    durBlur!();
    expect(ctx.actions.setDuration).toHaveBeenCalledWith('e-dur', '45:01');
  });
});
