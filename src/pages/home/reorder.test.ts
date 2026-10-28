import { describe, expect, it } from 'vitest';
import { reorder } from './reorder';

describe('reorder', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('往后拖：放在目标后面', () => expect(reorder(ids, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']));
  it('往前拖：放在目标前面', () => expect(reorder(ids, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']));
  it('拖到最后、最前', () => {
    expect(reorder(ids, 'b', 'd')).toEqual(['a', 'c', 'd', 'b']);
    expect(reorder(ids, 'c', 'a')).toEqual(['c', 'a', 'b', 'd']);
  });
  it('拖到自己或找不到时不变', () => {
    expect(reorder(ids, 'b', 'b')).toEqual(ids);
    expect(reorder(ids, 'x', 'b')).toEqual(ids);
  });
});
