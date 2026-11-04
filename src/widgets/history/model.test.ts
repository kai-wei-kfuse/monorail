// 0.3.0-beta.3 E8c 第 6 条：操作历史显示规则的关键分支（新建 / 删除、合并 ×N、改回原值、CLI 命令、未识别、系统）与筛选搜索。
import { describe, expect, it } from 'vitest';
import type { HistoryChange, HistoryRecord, HistorySource } from '../../shared/history';
import {
  agentOptions, changeRows, cliCommand, dayLabel, detectionNote, filterRecords, groupByDay, locateLabel, locateOf, mergeNote, rowSummary,
  sourceCounts, viaLabel,
} from './model';

const c = (type: HistoryChange['type'], id: string, name: string, field: string, before: string | null, after: string | null): HistoryChange =>
  ({ type, id, name, field, before, after });
let n = 0;
const rec = (source: HistorySource, more: Partial<HistoryRecord> = {}): HistoryRecord => ({ version: 1, id: `r${++n}`, at: '2026-11-08T10:00:00.000Z', day: '2026-11-08',
  action: 'test.direct', label: '测试', source, subject: null, changes: [], effects: [], ...more });
const CLI_FLAG: HistorySource = { kind: 'cli', agent: { name: '手环同步', detected_by: 'flag', evidence: '--agent 手环同步' } };
const MCP_RAW: HistorySource = { kind: 'mcp', agent: { name: null, raw: 'my-home-agent', version: '0.1.0', detected_by: 'mcp_handshake' } };
const NONE: HistorySource = { kind: 'cli', agent: { name: null, detected_by: 'none' } };

describe('改动表', () => {
  it('新建的对象合成一行「新条目」，删除的合成一行并标已删除；主体自己的字段只写字段名，别的对象带名字', () => {
    const rows = changeRows([
      c('entry', 'e1', '晨跑', '描述', null, '晨跑'), c('entry', 'e1', '晨跑', '项目', null, '运动'), c('entry', 'e1', '晨跑', '标签', null, '（无标签）'),
      c('entry', 'e2', '上厕所', '描述', '上厕所', null), c('entry', 'e2', '上厕所', '时间', '11.08 16:02–16:09', null),
      c('card', 'k1', '写周报', '状态', '进行中', '已完成'), c('entry', 'e3', '早饭', '时间', '08:30–至今', '08:30–10:02'),
      c('settings', 'accent', '强调色', '强调色', '#00f5a0', '#20b8ff'),
    ], { type: 'card', id: 'k1' });
    expect(rows).toEqual([
      { field: '新条目', before: null, after: '「晨跑」 · 运动' },
      { field: '条目「上厕所」', before: '「上厕所」 · 11.08 16:02–16:09', after: null },
      { field: '状态', before: '进行中', after: '已完成' },
      { field: '条目「早饭」· 时间', before: '08:30–至今', after: '08:30–10:02' },
      { field: '强调色', before: '#00f5a0', after: '#20b8ff' },
    ]);
  });
  it('设置合并：×N 的说明；全部来回标改回原值', () => {
    expect(mergeNote({ merged: 3 })).toContain('连续改了 3 次');
    expect(mergeNote({ merged: 2, reverted: true })).toContain('改回了原值');
    expect(mergeNote({})).toBeNull();
  });
});

describe('来源与调用', () => {
  it('来源小字：主窗口 · 页面、小窗、快速记录条、系统触发、调用方（对照表外按原样、未识别）', () => {
    expect(viaLabel({ kind: 'manual', via: 'main', page: 'calendar' })).toBe('主窗口 · 日历');
    expect(viaLabel({ kind: 'manual', via: 'mini' })).toBe('小窗');
    expect(viaLabel({ kind: 'manual', via: 'quickbar' })).toBe('快速记录条');
    expect(viaLabel({ kind: 'system', trigger: 'resume' })).toBe('休眠恢复');
    expect(viaLabel(MCP_RAW)).toBe('my-home-agent');
    expect(viaLabel(NONE)).toBe('未识别');
    expect(viaLabel({ kind: 'automation', agent: { name: null, detected_by: 'none' } })).toBe('未识别');
  });
  it('CLI 调用还原成命令，--agent 带上；参数截断、不是 CLI 时不给命令', () => {
    const call = (params: object, truncated = false) => ({ call: { method: 'add_time_entry', operation_id: 'op', params: JSON.stringify(params), truncated } });
    const p = { description: "晨跑 3km's", start: '2026-11-08T07:00:00+08:00', end: '2026-11-08T07:30:00+08:00', project: '运动', tags: ['健身'] };
    expect(cliCommand(rec(CLI_FLAG, call(p)))).toBe("node monorail-cli.mjs time add '晨跑 3km''s' --start 2026-11-08T07:00:00+08:00 --end 2026-11-08T07:30:00+08:00 --tag '健身' --project '运动' --agent '手环同步' --json");
    expect(cliCommand(rec(CLI_FLAG, call(p, true)))).toBeNull();
    expect(cliCommand(rec(MCP_RAW, call(p)))).toBeNull();
    expect(cliCommand(rec(NONE, { call: { method: 'stop_timer', operation_id: 'op', params: '{"expected_state":"ts1:x"}', truncated: false } }))).toBe('node monorail-cli.mjs timer stop --json');
  });
  it('识别方式说明：握手对照表外、环境变量、未识别', () => {
    expect(detectionNote({ name: null, raw: 'my-home-agent', version: '0.1.0', detected_by: 'mcp_handshake' })).toMatchObject({ code: 'name = my-home-agent，version = 0.1.0', tail: '（对照表里没有，按原样显示）' });
    expect(detectionNote({ name: 'Claude Code', detected_by: 'env', evidence: 'CLAUDECODE=1' })).toMatchObject({ code: 'CLAUDECODE=1' });
    expect(detectionNote({ name: null, detected_by: 'none' }).lead).toContain('没有握手信息');
  });
  it('系统的活动日切换没有单一主体：行里写那一天和改动项数', () => {
    expect(rowSummary(rec({ kind: 'system', trigger: 'dayChange' }, { changes: [c('state', 'home_mode', '计时状态', '首页', '任务卡', '回顾')] })))
      .toEqual({ text: '11 月 8 日 周日', meta: '1 项改动' });
  });
});

describe('筛选、搜索、分组、定位', () => {
  const list = [
    rec({ kind: 'manual', via: 'main', page: 'list' }, { label: '改条目', subject: { type: 'entry', id: 'e1', text: '打游戏', meta: '' } }),
    rec(CLI_FLAG, { label: '补录条目', call: { method: 'add_time_entry', operation_id: '019a-abc', params: '{}', truncated: false } }),
    rec(MCP_RAW, { label: '停止计时', day: '2026-11-07' }), rec(NONE, { label: '停止计时', day: '2026-11-07' }),
    rec({ kind: 'system', trigger: 'dayChange' }, { label: '活动日切换', day: '2026-11-07' }),
  ];
  it('来源计数与筛选；仅自动化下按调用方；搜索 operation_id、方法名、调用方', () => {
    expect(sourceCounts(list)).toEqual({ all: 5, auto: 3, manual: 1, system: 1 });
    expect(filterRecords(list, { kind: 'auto', agent: 'my-home-agent', q: '' }).map(r => r.label)).toEqual(['停止计时']);
    expect(filterRecords(list, { kind: 'all', agent: 'all', q: '019A-ABC' }).map(r => r.label)).toEqual(['补录条目']);
    expect(filterRecords(list, { kind: 'all', agent: 'all', q: 'add_time' })).toHaveLength(1);
    expect(filterRecords(list, { kind: 'all', agent: 'all', q: '手环' })).toHaveLength(1);
    expect(filterRecords(list, { kind: 'all', agent: 'all', q: '打游戏' })).toHaveLength(1);
  });
  it('调用方下拉：未识别放最后；按记录里的 day 分组', () => {
    const labels = agentOptions(list).map(o => o.label);
    expect(labels.at(-1)).toBe('未识别');
    expect([...labels].sort()).toEqual(['my-home-agent', '手环同步', '未识别'].sort());
    expect(groupByDay(list).map(g => [g.day, g.records.length])).toEqual([['2026-11-08', 2], ['2026-11-07', 3]]);
    expect(dayLabel('2026-11-08', '2026-11-08')).toBe('今天');
    expect(dayLabel('2026-11-07', '2026-11-08')).toBe('昨天');
    expect(dayLabel('2026-11-05', '2026-11-08')).toBe('11 月 5 日 周四');
  });
  it('定位：列表页改的条目回列表，日历的去日历；卡片去背包；设置去设置', () => {
    expect(locateOf(list[0])).toEqual({ page: 'list', entryId: 'e1', day: '2026-11-08' });
    expect(locateLabel(locateOf(list[0]))).toBe('列表 · 11.08');
    expect(locateOf(rec(NONE, { changes: [c('entry', 'e9', 'x', '时间', 'a', 'b')] }))).toMatchObject({ page: 'calendar', entryId: 'e9' });
    expect(locateOf(rec(NONE, { subject: { type: 'card', id: 'k', text: '', meta: '' } }))).toEqual({ page: 'backpack' });
    expect(locateOf(rec(NONE, { subject: { type: 'settings', id: 'accent', text: '', meta: '' } }))).toEqual({ page: 'settings' });
  });
});
