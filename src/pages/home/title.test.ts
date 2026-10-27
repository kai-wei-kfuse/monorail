import { describe, expect, it } from 'vitest';
import { fitTitleSize } from './title';
import { parseMarks, plainText as plainTitle } from '../../ui/marks/MarkedText';

describe('parseMarks', () => {
  it('拆出重点词', () => {
    expect(parseMarks('沿 [Python] 往下学 1 小时')).toEqual([
      { text: '沿 ', mark: false }, { text: 'Python', mark: true }, { text: ' 往下学 1 小时', mark: false }]);
  });
  it('多个重点词、没配对的方括号按原文保留', () => {
    expect(parseMarks('[A][B] c [d')).toEqual([{ text: 'A', mark: true }, { text: 'B', mark: true }, { text: ' c [d', mark: false }]);
    expect(plainTitle('改 [简历] 一段')).toBe('改 简历 一段');
  });
});

describe('fitTitleSize', () => {
  it('放得下 96 就用 96 再乘比例', () => {
    expect(fitTitleSize(() => true, 65)).toBe(62);
  });
  it('否则取能放下的最大字号', () => {
    expect(fitTitleSize(s => s <= 70, 100)).toBe(70);
  });
  it('不低于下限', () => {
    expect(fitTitleSize(() => false, 50)).toBe(26);
  });
});
