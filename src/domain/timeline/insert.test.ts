import { describe, expect, it } from 'vitest';
import type { TimeEntry } from './entry';
import { entryAction, insertState, insertToContinue } from './insert';
import type { EntrySource } from './insert';

// 插入的状态与入口判断（ADR 0021 第 3 条状态表、入口表）
const t = (m: number) => new Date(2026, 10, 6, 10, m).toISOString();
const e = (id: string, over: Partial<TimeEntry> = {}): TimeEntry => ({ id, started_at: t(0), ended_at: null, description: id, project: '学习', tags: [],
  card_id: null, kind: '普通', source: '计时', updated_at: t(0), ...over });
const cardEntry = e('card', { card_id: 'c1', ended_at: t(10) });
const freeEntry = e('free', { ended_at: t(10) });
const idle = (kind: TimeEntry['kind']) => e('idle', { project: '待机', kind, started_at: t(20) });
const SOURCES: EntrySource[] = ['quick', 'temp', 'favorite', 'timerBox', 'mini', 'recent', 'continue', 'mcpTimer', 'mcpBreak'];
const always = new Set<EntrySource>(['quick', 'temp', 'mcpBreak']);

describe('insertState', () => {
  it('以回到目标不为空为前提：没有回到目标时不算插入', () => {
    expect(insertState(e('x', { kind: '插入' }), undefined)).toBeNull();
    expect(insertState(e('x', { kind: '插入' }), cardEntry)).toBe('inserting');
    expect(insertState(idle('插入'), cardEntry)).toBe('insertPaused');
    expect(insertState(idle('暂停'), cardEntry)).toBeNull();   // 卡暂停中
  });
});

describe('entryAction：每个入口一行（ADR 0021 第 3 条）', () => {
  it.each(SOURCES)('%s：做卡时插入、卡暂停中插入、插入中替换', source => {
    expect(entryAction(e('run', { card_id: 'c1' }), undefined, source)).toBe('insert');
    expect(entryAction(idle('暂停'), cardEntry, source)).toBe('insert');
    expect(entryAction(e('ins', { kind: '插入' }), cardEntry, source)).toBe('replace');
    expect(entryAction(idle('插入'), cardEntry, source)).toBe('replace');
  });
  it.each(SOURCES)('%s：自由计时时只有快捷活动、临时活动插入，其余切换', source => {
    expect(entryAction(e('run'), undefined, source)).toBe(always.has(source) ? 'insert' : 'switch');
  });
  it.each(SOURCES)('%s：自由记录暂停中只有快捷活动、临时活动插入；待机时都直接开始', source => {
    expect(entryAction(idle('暂停'), freeEntry, source)).toBe(always.has(source) ? 'insert' : 'start');
    expect(entryAction(idle('普通'), undefined, source)).toBe('start');
    expect(entryAction(undefined, undefined, source)).toBe('start');
  });
});

describe('insertToContinue（第 3 轮 N1）', () => {
  it('找回到目标之后最后结束的那条插入', () => {
    const ins1 = e('i1', { kind: '插入', started_at: t(10), ended_at: t(14) }), ins2 = e('i2', { kind: '插入', started_at: t(14), ended_at: t(20) });
    expect(insertToContinue([cardEntry, ins1, ins2, idle('插入')], idle('插入'), cardEntry)?.id).toBe('i2');
  });
  it('日历里把插入拖短、留出空隙也找得到', () => {
    const ins = e('i', { kind: '插入', started_at: t(10), ended_at: t(15) });
    expect(insertToContinue([cardEntry, ins, idle('插入')], idle('插入'), cardEntry)?.id).toBe('i');
  });
  it('中间夹了别的非待机条目，或者根本没有插入：找不到', () => {
    const ins = e('i', { kind: '插入', started_at: t(10), ended_at: t(14) }), other = e('o', { started_at: t(15), ended_at: t(18) });
    expect(insertToContinue([cardEntry, ins, other, idle('插入')], idle('插入'), cardEntry)).toBeNull();
    expect(insertToContinue([cardEntry, idle('插入')], idle('插入'), cardEntry)).toBeNull();
  });
});
