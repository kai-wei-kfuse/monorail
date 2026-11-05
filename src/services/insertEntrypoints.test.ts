import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/**
 * R3（执行方案 G4）：开始计时的调用点要么经过入口判断（startOtherInTx → entryAction），要么在白名单里。
 * 新加一个开始计时的入口而没有走判断，这条会失败，提醒把它接到 startOtherInTx 上。
 */
const WHITELIST: { file: string; pattern: RegExp; why: string }[] = [
  { file: 'homeService.ts', pattern: /if \(decision === 'insert' \|\| decision === 'replace'\) \{ tracking\.insertInTx/, why: '入口判断本身' },
  { file: 'homeService.ts', pattern: /^\s*tracking\.startInTx\(tx, \{ \.\.\.value, card_id: null \}, from\);$/m, why: '入口判断本身' },
  { file: 'homeService.ts', pattern: /tracking\.startSystemInTx\(tx, '睡眠'\)/, why: '睡觉：有意结束原任务（ADR 0021 第 3 条）' },
  { file: 'homeService.ts', pattern: /tracking\.startSystemInTx\(tx, '待机'\)/, why: '醒来' },
  { file: 'homeService.ts', pattern: /^\s*tracking\.insertInTx\(tx, template\(tx, activity\)\);$/m, why: '补记切换：插入后立即改读数（0.2.5 行为）' },
  { file: 'commit.ts', pattern: /startSystemInTx\(tx, '待机'\)/, why: '没有开着的条目时自动开始待机' },
  { file: 'degradeService.ts', pattern: /startSystemInTx\(tx, '休息'\)/, why: '0.3.0 遗留降级休息（G5 删）' },
  { file: 'degradeService.ts', pattern: /startSystemInTx\(tx, '待机'\)/, why: '0.3.0 遗留降级休息回来（G5 删）' },
];
const CALL = /(?:tracking\.)?(?:startInTx|insertInTx|startSystemInTx|startEntryInTx)\(/g;

it('白名单本身能识别出一个没走判断的新入口（防止这条检查永远通过）', () => {
  const line = '  tracking.startInTx(tx, { description: x, project: y, tags: [], card_id: null }, tx.at);';
  CALL.lastIndex = 0;
  expect(CALL.test(line)).toBe(true); CALL.lastIndex = 0;
  expect(WHITELIST.some(w => w.file === 'homeService.ts' && w.pattern.test(line))).toBe(false);
});

it('所有开始计时的调用都经过入口判断或在白名单里', () => {
  const dir = join(__dirname);
  const offenders: string[] = [];
  for (const name of readdirSync(dir).filter(n => n.endsWith('.ts') && !n.includes('.test.') && n !== 'serviceFixture.ts')) {
    const text = readFileSync(join(dir, name), 'utf8');
    text.split('\n').forEach((line, i) => {
      if (!CALL.test(line)) return; CALL.lastIndex = 0;
      if (/^\s*(import|export|\/\/|\*)/.test(line) || /function (startInTx|insertInTx|startSystemInTx)/.test(line)) return;
      if (WHITELIST.some(w => w.file === name && w.pattern.test(line))) return;
      offenders.push(`${name}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(offenders).toEqual([]);
});
