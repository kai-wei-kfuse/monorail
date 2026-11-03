import { expect, it } from 'vitest';
import type { TimeEntry } from './entry';
import { cardMilliseconds, activityDayTotals, summarizeDay, clipEntriesInRange } from './stats';
import { activityDay } from './day';
import { HOUR, MINUTE } from '../../shared/time';
import { timeSummaryResult } from '../../shared/application';
import { newProject, validateUserTags } from './project';

const entry = (index: number, start: string, end: string | null, card: string | null): TimeEntry => ({
  id: crypto.randomUUID(), started_at: start, ended_at: end, description: card ? '任务' : '生活',
  project: card ? '主线' : '生活', card_id: card, kind: '普通', source: index === 1 ? '计时' : '手动', tags: [], updated_at: start,
});

it('A1 sums parallel work independently across activity days', () => {
  const rows = [
    entry(1, '2026-10-26T10:00:00Z', '2026-10-26T11:00:00Z', 'a'),
    entry(2, '2026-10-26T10:20:00Z', '2026-10-26T10:40:00Z', null),
    entry(3, '2026-10-27T10:00:00Z', null, 'a'),
  ];
  expect(cardMilliseconds(rows, 'a', '2026-10-27T10:30:00Z')).toBe(90 * 60000);
});

it('A5 splits daily totals at configured boundary and preserves completion day conventions', () => {
  const at = (hour: number) => new Date(2026, 9, 27, hour).toISOString();
  const rows = [entry(1, at(3), at(5), 'a')];
  expect(activityDayTotals(rows, at(5), 4)).toEqual({ '2026-10-26': { 主线: 3600000 }, '2026-10-27': { 主线: 3600000 } });
  expect(activityDay(at(1), 4)).toBe('2026-10-26');
  expect(activityDay(at(4), 4)).toBe('2026-10-27');
});

it('summarizes non-idle coverage, idle/paused, overlaps, untracked gaps and activity-day 02:30 boundary', () => {
  const local = (day: number, hour: number, min = 0) => new Date(2026, 10, day, hour, min, 0, 0).toISOString();
  const rows: TimeEntry[] = [
    // Cross-boundary entry starting at 03:00 (previous activity day) and ending at 05:00
    { id: 'e1', started_at: local(3, 3, 0), ended_at: local(3, 5, 0), description: '早起阅读', project: '学习', tags: ['读书', '专注'], card_id: null, kind: '普通', source: '计时', updated_at: local(3, 5, 0) },
    // Plain idle from 05:00 to 06:00
    { id: 'e2', started_at: local(3, 5, 0), ended_at: local(3, 6, 0), description: '待机', project: '待机', tags: [], card_id: null, kind: '普通', source: '自动', updated_at: local(3, 6, 0) },
    // Triple overlap between 06:00 and 07:00:
    // A: 06:00-07:00 (60m), B: 06:15-06:45 (30m), C: 06:30-07:00 (30m) => union 60m, recorded 120m, excess 60m
    { id: 'e3', started_at: local(3, 6, 0), ended_at: local(3, 7, 0), description: '写代码', project: '工作', tags: ['专注'], card_id: null, kind: '普通', source: '计时', updated_at: local(3, 7, 0) },
    { id: 'e4', started_at: local(3, 6, 15), ended_at: local(3, 6, 45), description: '听播客', project: '生活', tags: ['播客'], card_id: null, kind: '普通', source: '手动', updated_at: local(3, 6, 45) },
    { id: 'e5', started_at: local(3, 6, 30), ended_at: local(3, 7, 0), description: '查资料', project: '工作', tags: ['专注', '检索'], card_id: null, kind: '普通', source: '手动', updated_at: local(3, 7, 0) },
    // Untracked gap from 07:00 to 08:00 (60m)
    // Paused idle open entry from 08:00 to as_of (08:30, 30m)
    { id: 'e6', started_at: local(3, 8, 0), ended_at: null, description: '待机', project: '待机', tags: [], card_id: null, kind: '暂停', source: '自动', updated_at: local(3, 8, 0) },
  ];

  const summary = summarizeDay(rows, {
    day: 'today',
    dayMode: 'activity',
    boundaryHour: 4,
    asOf: local(3, 8, 30),
    timezone: 'Asia/Shanghai',
  });

  expect(summary.resolved_day).toBe('2026-11-03');
  expect(summary.interval_elapsed_ms).toBe(4.5 * HOUR);
  expect(summary.non_idle_covered_ms).toBe(2 * HOUR); // 04:00-05:00 + 06:00-07:00
  expect(summary.non_idle_recorded_ms).toBe(3 * HOUR); // 60m + 60m + 30m + 30m
  expect(summary.overlap_excess_ms).toBe(1 * HOUR);
  expect(summary.idle_plain_ms).toBe(1 * HOUR);
  expect(summary.paused_ms).toBe(30 * MINUTE);
  expect(summary.idle_ms).toBe(1.5 * HOUR);
  expect(summary.untracked_ms).toBe(1 * HOUR);
  expect(summary.non_idle_covered_ms + summary.idle_ms + summary.untracked_ms).toBe(summary.interval_elapsed_ms);
  expect(summary.by_project).toEqual({
    学习: 1 * HOUR,
    待机: 1.5 * HOUR,
    工作: 1.5 * HOUR,
    生活: 30 * MINUTE,
  });
  expect(summary.by_tag).toEqual({
    读书: 1 * HOUR,
    专注: 2.5 * HOUR,
    播客: 30 * MINUTE,
    检索: 30 * MINUTE,
  });

  // At 02:30 on 2026-11-04, activity-day "today" is still 2026-11-03, while calendar "today" is 2026-11-04.
  const beforeBoundaryActivity = summarizeDay([], {
    day: 'today', dayMode: 'activity', boundaryHour: 4, asOf: local(4, 2, 30), timezone: 'Asia/Shanghai',
  });
  const beforeBoundaryCalendar = summarizeDay([], {
    day: 'today', dayMode: 'calendar', boundaryHour: 4, asOf: local(4, 2, 30), timezone: 'Asia/Shanghai',
  });
  expect(beforeBoundaryActivity.resolved_day).toBe('2026-11-03');
  expect(beforeBoundaryCalendar.resolved_day).toBe('2026-11-04');
});

it('handles future dates with zero elapsed time and rejects invalid dates or clock rollback', () => {
  const nowIso = new Date(2026, 10, 3, 12, 0, 0).toISOString();
  const future = summarizeDay([], { day: '2026-11-05', dayMode: 'activity', boundaryHour: 4, asOf: nowIso, timezone: 'UTC' });
  expect(future.interval_elapsed_ms).toBe(0);
  expect(future.untracked_ms).toBe(0);

  expect(() => summarizeDay([], { day: '2026-02-31', dayMode: 'activity', boundaryHour: 4, asOf: nowIso, timezone: 'UTC' }))
    .toThrow('INVALID_DATE');

  const futureEntry = entry(1, new Date(2026, 10, 3, 13, 0, 0).toISOString(), null, null);
  expect(() => summarizeDay([futureEntry], { day: 'today', dayMode: 'activity', boundaryHour: 4, asOf: nowIso, timezone: 'UTC' }))
    .toThrow('CLOCK_INCONSISTENT');
  expect(() => clipEntriesInRange([futureEntry], new Date(2026, 10, 3, 10, 0, 0).toISOString(), new Date(2026, 10, 3, 14, 0, 0).toISOString(), nowIso))
    .toThrow('CLOCK_INCONSISTENT');
});

it('R3: preserves prototype-colliding project and tag names (constructor, __proto__, toString) and supports this_week', () => {
  expect(newProject([], 'constructor').name).toBe('constructor');
  expect(validateUserTags(['constructor', '__proto__', 'toString'])).toEqual(['constructor', '__proto__', 'toString']);

  const start = '2026-11-03T06:00:00.000Z';
  const end = '2026-11-03T07:00:00.000Z';
  const rows: TimeEntry[] = [
    { id: 'r1', started_at: start, ended_at: end, description: 'ctor', project: 'constructor', tags: ['constructor', '__proto__'], card_id: null, kind: '普通', source: '手动', updated_at: end },
    { id: 'r2', started_at: start, ended_at: end, description: 'proto', project: '__proto__', tags: ['toString', '中文标签'], card_id: null, kind: '普通', source: '手动', updated_at: end },
  ];

  const raw = summarizeDay(rows, { day: 'today', dayMode: 'calendar', boundaryHour: 0, asOf: end, timezone: 'Asia/Shanghai' });
  expect(typeof raw.by_project.constructor).toBe('number');
  expect(raw.by_project.constructor).toBe(HOUR);
  expect(Object.hasOwn(raw.by_project, '__proto__')).toBe(true);
  expect(raw.by_project['__proto__']).toBe(HOUR);
  expect(Object.hasOwn(raw.by_tag, '__proto__')).toBe(true);
  expect(raw.by_tag['__proto__']).toBe(HOUR);
  expect(raw.by_tag.toString).toBe(HOUR);

  const parsed = timeSummaryResult.parse(raw);
  expect(typeof parsed.by_project.constructor).toBe('number');
  expect(Object.hasOwn(parsed.by_project, '__proto__')).toBe(true);
  expect(Object.hasOwn(parsed.by_tag, '__proto__')).toBe(true);

  const totals = activityDayTotals(rows, end, 4);
  expect(typeof totals['2026-11-03'].constructor).toBe('number');
  expect(Object.hasOwn(totals['2026-11-03'], '__proto__')).toBe(true);

  const weekSummary = summarizeDay(rows, { day: 'this_week', dayMode: 'activity', boundaryHour: 4, asOf: end, timezone: 'Asia/Shanghai' });
  expect(weekSummary.resolved_day).toBe('2026-11-02'); // Monday of 2026-W45
  expect(weekSummary.non_idle_recorded_ms).toBe(2 * HOUR);
});
