import { describe, expect, it } from 'vitest';
import { parseEntryText } from './tags';

const projects = ['学习', '工作', '未分类'];

describe('parseEntryText', () => {
  it('取出标签和项目，正文去掉它们', () =>
    expect(parseEntryText('看 OS 第三章 #408 @学习 #复习', projects)).toEqual({ description: '看 OS 第三章', tags: ['408', '复习'], project: '学习' }));
  it('没写的就空着', () => expect(parseEntryText('  写周报 ', projects)).toEqual({ description: '写周报', tags: [], project: null }));
  it('不存在的项目当没写，也从正文里去掉', () => expect(parseEntryText('跑步 @健身', projects)).toEqual({ description: '跑步', tags: [], project: null }));
  it('重复的标签只留一个；只写了标签时正文为空', () => expect(parseEntryText('#a #a', projects)).toEqual({ description: '', tags: ['a'], project: null }));
});
