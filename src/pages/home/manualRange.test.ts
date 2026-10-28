import { describe, expect, it } from 'vitest';
import { manualRange } from './manualRange';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();   // 2026 年 10 月，本地时间
const now = at(28, 15);

describe('manualRange', () => {
  it('开始 + 结束', () => expect(manualRange('9:30', '11', '', now)).toEqual({ start: at(28, 9, 30), end: at(28, 11) }));
  it('开始 + 时长、结束 + 时长', () => {
    expect(manualRange('9:30', '', '1h 30m', now)).toEqual({ start: at(28, 9, 30), end: at(28, 11) });
    expect(manualRange('', '11', '90', now)).toEqual({ start: at(28, 9, 30), end: at(28, 11) });
  });
  it('只填时长 = 刚刚做完', () => expect(manualRange('', '', '45', now)).toEqual({ start: at(28, 14, 15), end: now }));
  it('三项都填时按开始、结束算', () => expect(manualRange('9', '10', '5', now)).toEqual({ start: at(28, 9), end: at(28, 10) }));
  it('跨过午夜：开始在昨晚', () => expect(manualRange('23', '1', '', at(28, 2))).toEqual({ start: at(27, 23), end: at(28, 1) }));
  it('结束早于开始、算到第二天就晚于现在 → 拒绝', () => expect(manualRange('11', '10', '', now)).toEqual({ error: '结束不能晚于现在' }));
  it('开始 + 时长超过现在 → 拒绝', () => expect(manualRange('14:30', '', '90', now)).toEqual({ error: '结束不能晚于现在' }));
  it('只填一项、看不懂、时长为 0', () => {
    expect(manualRange('9', '', '', now)).toHaveProperty('error', '开始、结束、时长里填两项（只填时长 = 刚刚做完）');
    expect(manualRange('9:7x', '10', '', now)).toHaveProperty('error');
    expect(manualRange('', '', '0', now)).toEqual({ error: '时长要大于 0' });
  });
});
