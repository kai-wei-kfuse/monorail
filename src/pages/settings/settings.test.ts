import { createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { defaults } from '../../shared/settings';
import type { QuickActivity } from '../../shared/settings';
import { PresetEditor } from './PresetEditor';
import { SettingsPage } from './SettingsPage';

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

describe('settings defaults & UI', () => {
  it('默认采用融合首页布局与薄荷绿强调色，并在外观设置页默认选中', () => {
    expect(defaults.homeLayout).toBe('fused');
    expect(defaults.accent).toBe('#00f5a0');
    const html = renderToStaticMarkup(createElement(SettingsPage, {
      section: 'look', onSection: vi.fn(), settings: structuredClone(defaults),
      onChange: vi.fn(), onListsChange: vi.fn(), projects: [], knownTags: [],
      dataDir: 'D:\\monorail', onChangeDir: vi.fn(), version: '0.2.5',
    }));
    expect(html).toContain('aria-checked="true" tabindex="0">融合</button>');
    expect(html).toContain('<span class="sw-name">薄荷绿</span>');
  });

  it('窗口与数据设置将小小窗口改名为 mini窗口，点击切换 tiny 模式', () => {
    const onChange = vi.fn();
    const tree = createElement(SettingsPage, {
      section: 'window', onSection: vi.fn(), settings: structuredClone(defaults),
      onChange, onListsChange: vi.fn(), projects: [], knownTags: [],
      dataDir: 'D:\\monorail', onChangeDir: vi.fn(), version: '0.2.5',
    });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('mini窗口');
    expect(html).not.toContain('小小窗口');

    let clickMini: (() => void) | null = null;
    walk(tree, el => {
      const ch = el.props.children;
      const text = Array.isArray(ch) ? ch[0] : ch;
      if (el.type === 'button' && el.props.role === 'radio' && text === 'mini窗口') {
        clickMini = el.props.onClick as () => void;
      }
    });
    expect(clickMini).not.toBeNull();
    clickMini!();
    expect(onChange).toHaveBeenCalledWith('miniMode', 'tiny');
  });

  it('预设与快捷活动编辑器（05）的分类和标签使用列表同款 flat 无框样式，并保留修改回调', () => {
    const presets: QuickActivity[] = [
      { id: 'q1', name: '吃饭', project: '生活', tags: ['日常'], mode: '插入', place: '弹层' },
      { id: 'q2', name: '上厕所', project: '生活', tags: [], mode: '插入', place: '弹层' },
    ];
    const onChange = vi.fn(), onCreateProject = vi.fn(), onCreateTag = vi.fn();
    const tree = createElement(PresetEditor, {
      presets, place: '弹层', placeholder: '例如：厕所、拿快递、吃饭',
      projects: [{ name: '生活', color: '#888884' }, { name: '运动', color: '#00f5a0' }],
      knownTags: ['日常', '休息'],
      onChange, onCreateProject, onCreateTag,
    });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('class="combo flat"');
    expect(html).toContain('class="tagpick flat"');
    expect(html).not.toContain('class="combo sm"');

    // 验证删除已有标签片触发 onChange 更新对应预设
    let removeTag: ((e: { stopPropagation: () => void }) => void) | null = null;
    walk(tree, el => {
      if (el.type === 'button' && el.props['aria-label'] === '移除 #日常') {
        removeTag = el.props.onClick as (e: { stopPropagation: () => void }) => void;
      }
    });
    expect(removeTag).not.toBeNull();
    removeTag!({ stopPropagation: vi.fn() });
    expect(onChange).toHaveBeenCalledWith([
      { id: 'q1', name: '吃饭', project: '生活', tags: [], mode: '插入', place: '弹层' },
      presets[1],
    ]);
  });
});
