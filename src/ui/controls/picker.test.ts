import { describe, expect, it } from 'vitest';
import { enterChoice, matching, moveActive, popupPlacement, tagName } from './picker';

const PROJECTS = ['未分类', '学习', '求职', 'Python'];

describe('matching', () => {
  it('没写字时列出全部', () => expect(matching(PROJECTS, '  ')).toEqual(PROJECTS));
  it('按包含筛选，不分大小写', () => {
    expect(matching(PROJECTS, '学')).toEqual(['学习']);
    expect(matching(PROJECTS, 'py')).toEqual(['Python']);
  });
});

describe('enterChoice', () => {
  it('上下键选中的那一项优先', () => expect(enterChoice(['学习', '求职'], PROJECTS, '学', 1, true)).toEqual({ pick: '求职' }));
  it('没选中时，同名的就选它', () => expect(enterChoice(['学习'], PROJECTS, '学习', -1, true)).toEqual({ pick: '学习' }));
  it('没有同名的：允许新建就新建，不允许就什么都不做', () => {
    expect(enterChoice(['学习'], PROJECTS, '学', -1, true)).toEqual({ create: '学' });
    expect(enterChoice(['学习'], PROJECTS, '学', -1, false)).toBeNull();
  });
  it('没写字也没选中，什么都不做', () => expect(enterChoice(PROJECTS, PROJECTS, '', -1, true)).toBeNull());
});

describe('moveActive', () => {
  it('没选时向下到第一项、向上到最后一项', () => {
    expect(moveActive(-1, 3, true)).toBe(0);
    expect(moveActive(-1, 3, false)).toBe(2);
  });
  it('首尾相接', () => {
    expect(moveActive(2, 3, true)).toBe(0);
    expect(moveActive(0, 3, false)).toBe(2);
  });
  it('列表为空时不选', () => expect(moveActive(0, 0, true)).toBe(-1));
});

describe('popupPlacement', () => {
  const view = { width: 1280, height: 800 };
  it('地方够就往右下开', () => expect(popupPlacement({ left: 100, bottom: 300 }, view)).toBe(''));
  it('靠近底部向上，靠近右边和控件右边对齐', () => {
    expect(popupPlacement({ left: 100, bottom: 600 }, view)).toBe(' up');
    expect(popupPlacement({ left: 1150, bottom: 300 }, view)).toBe(' end');
    expect(popupPlacement({ left: 1150, bottom: 600 }, view)).toBe(' up end');
  });
});

describe('tagName', () => {
  it('去掉空白和开头的 #', () => {
    expect(tagName(' #408 ')).toBe('408');
    expect(tagName('##户外')).toBe('户外');
    expect(tagName('# ')).toBe('');
  });
});
