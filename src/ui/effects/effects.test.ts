import { describe, expect, it } from 'vitest';
import { contours, field, noise3 } from './topoField';
import { decodeFrame } from './decode';

describe('noise3', () => {
  it('结果确定，范围约在 [-1, 1]，整数格点上为 0', () => {
    expect(noise3(1.3, 2.7, .5)).toBe(noise3(1.3, 2.7, .5));
    expect(noise3(3, 4, 5)).toBe(0);
    for (let i = 0; i < 200; i++) expect(Math.abs(noise3(i * .37, i * .11, i * .05))).toBeLessThanOrEqual(1.05);
  });
});

describe('contours', () => {
  it('一条斜坡上的等值线落在格子内部，并按每第 5 条分出计曲线', () => {
    // 3×2 个点、两个格子：高度从左到右 0 → .2 → .4。左格有第 0（计曲线）、1、2 条，右格有第 3、4 条
    const F = Float32Array.from([0, .2, .4, 0, .2, .4]);
    const { thin, bold } = contours(F, 3, 2, 10);
    expect(thin.length).toBe(4 * 4);
    expect(bold).toEqual([0, 0, 0, 10]);
    for (let i = 0; i < thin.length; i += 2) {
      expect(thin[i]).toBeGreaterThan(0); expect(thin[i]).toBeLessThan(20);
      expect(thin[i + 1]).toBeGreaterThanOrEqual(0); expect(thin[i + 1]).toBeLessThanOrEqual(10);
    }
  });
  it('1200×690 的卡片算一帧在合理时间内', () => {
    const cell = 12, nx = Math.ceil(1200 / cell) + 1, ny = Math.ceil(690 / cell) + 1;
    const t0 = performance.now();
    const { thin, bold } = contours(field(nx, ny, cell, 3.7), nx, ny, cell);
    expect(thin.length + bold.length).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe('decodeFrame', () => {
  it('前 floor(len·p) 个字定稿，其余随机，空格保留', () => {
    const rnd = () => 0;
    expect(decodeFrame('AB CD', 0, rnd)).toBe('AA AA');
    expect(decodeFrame('AB CD', .4, rnd)).toBe('AB AA');
    expect(decodeFrame('AB CD', 1, rnd)).toBe('AB CD');
  });
});
