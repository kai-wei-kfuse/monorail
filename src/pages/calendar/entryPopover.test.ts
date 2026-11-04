// 0.3.0-beta.3 D3：日历条目弹窗直接改开始 / 结束 / 时长；项目、标签用 flat 样式。
import { createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EntryPopover } from './EntryPopover';
import { InlineCell } from '../../ui/controls/InlineCell';

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useState: vi.fn((init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, vi.fn()]),
  useRef: vi.fn((init = null) => ({ current: init })),
  useId: vi.fn(() => 'id-mock'),
  useEffect: vi.fn(),
}));

/** 只展开到 InlineCell 为止，好拿到它的属性。 */
function cells(node: ReactNode, out: Record<string, Record<string, unknown>> = {}) {
  if (!node) return out;
  if (Array.isArray(node)) { node.forEach(child => cells(child, out)); return out; }
  if (!isValidElement(node)) return out;
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === InlineCell) { out[el.props.label as string] = el.props; return out; }
  if (typeof el.type === 'function') return cells((el.type as (p: Record<string, unknown>) => ReactNode)(el.props), out);
  cells(el.props.children as ReactNode, out);
  return out;
}

// 测试环境是 node：弹窗按窗口大小摆位置，给一个固定的窗口
vi.stubGlobal('window', { innerWidth: 1400, innerHeight: 900 });
const at = (h: number, m = 0) => new Date(2026, 10, 4, h, m).getTime();
const iso = (t: number) => new Date(t).toISOString();
function props(ended: number | null, extra: Record<string, unknown> = {}) {
  return {
    entry: { id: 'e1', started_at: iso(at(15, 51)), ended_at: ended === null ? null : iso(ended), description: '写周报', project: '工作', tags: ['周报'], card_id: null },
    x: 0, y: 0, now: at(16, 30), projects: [{ name: '工作', color: '#8f6bff' }], knownTags: ['周报'], onClose: vi.fn(),
    onPatch: vi.fn(), onContinue: vi.fn(), onCopy: vi.fn(), onFavorite: vi.fn(), onSaveAsCard: vi.fn(), onDelete: vi.fn(),
    onCreateProject: vi.fn(), onCreateTag: vi.fn(), onSetStart: vi.fn(), onSetEnd: vi.fn(), onSetDuration: vi.fn(), ...extra,
  };
}

describe('EntryPopover 时间与 flat', () => {
  it('结束了的条目：开始、结束、时长三格都可改，提交交给对应动作', () => {
    const p = props(at(16, 21)), c = cells(createElement(EntryPopover, p));
    expect(Object.keys(c)).toEqual(['开始', '结束', '时长']);
    expect([c['开始'].value, c['结束'].value, c['时长'].value]).toEqual(['15:51', '16:21', '30:00']);
    expect([c['开始'].readOnly, c['结束'].readOnly, c['时长'].readOnly]).toEqual([undefined, false, false]);
    (c['开始'].onCommit as (t: string) => void)('15:40');
    (c['结束'].onCommit as (t: string) => void)('16:30');
    (c['时长'].onCommit as (t: string) => void)('1h 30m');
    expect(p.onSetStart).toHaveBeenCalledWith('15:40');
    expect(p.onSetEnd).toHaveBeenCalledWith('16:30');
    expect(p.onSetDuration).toHaveBeenCalledWith('1h 30m');
  });
  it('正在计时：只能改开始，结束写 NOW，结束和时长只读', () => {
    const c = cells(createElement(EntryPopover, props(null)));
    expect([c['结束'].value, c['结束'].readOnly, c['时长'].readOnly]).toEqual(['NOW', true, true]);
    expect(c['时长'].value).toBe('39:00');
    expect(c['开始'].readOnly).toBeUndefined();
  });
  it('项目、标签是 flat 样式，不再有带框的控件；顶部不再是静态的「· N 分钟」', () => {
    const html = renderToStaticMarkup(createElement(EntryPopover, props(at(16, 21))));
    expect(html).toContain('class="combo flat');
    expect(html).toContain('class="tagpick flat');
    expect(html).not.toContain('分钟</em>');
    expect(html).toContain('aria-label="开始"');
  });
});
