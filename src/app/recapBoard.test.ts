// 0.3.0-beta.3 E7：回看看板的显示用纯函数与关键分支（空数据、上一期不可比、按桶筛选、超过上限出现展开按钮）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { computeRecap } from '../domain/review/recap';
import type { TimeEntry } from '../domain/timeline/entry';
import type { Card } from '../domain/card/card';
import { DEFAULT_RECAP_VIEW } from '../shared/recap';
import type { RecapQuery } from '../shared/recap';
import { collapse, delta, hm, hoursLabel, inBucket, msDelta, pct, pointDelta, yTicks } from '../pages/review/recap/format';
import { footnotes } from '../pages/review/recap/Breakdown';
import { RecapBoard } from '../pages/review/recap/RecapBoard';
import { DoneNotes } from '../pages/review/recap/DoneNotes';

vi.stubGlobal('window', { innerWidth: 1400, innerHeight: 900 });
const MIN = 60_000, HOUR = 60 * MIN;
const t = (m: number, d: number, h: number) => new Date(2026, m - 1, d, h).toISOString();
const NOW = t(11, 8, 20);
let n = 0;
const e = (start: string, end: string, extra: Partial<TimeEntry> = {}): TimeEntry => ({ id: `e${++n}`, started_at: start, ended_at: end, description: '学习',
  project: '学习', tags: [], card_id: null, kind: '普通', source: '计时', updated_at: end, ...extra });
const done = (i: number): Card => ({ id: `c${i}`, source_record_id: null, content: `卡${i}`, created_at: t(10, 1, 9), due_at: null, blocking: false, task_id: null,
  project: null, tags: [], status: '已完成', type: '结果卡', order: 1, timebox_minutes: null, no_shrink: false, shrunk_from: null, shrink_level: 0,
  continued_from: null, skip_count: 0, completed_at: t(11, 2 + (i % 6), 18), completed_day: null, completed_track: '支线', progress_note: '' } as Card);
const recap = (query: Partial<RecapQuery> = {}, entries: TimeEntry[] = [e(t(11, 3, 9), t(11, 3, 11)), e(t(10, 28, 9), t(10, 28, 10))], cards: Card[] = [], firstUsedDay = '2026-10-01') =>
  computeRecap({ entries, cards, tasks: [], lastReviewAt: null, firstUsedDay, projectColors: {}, boundaryHour: 4, asOf: NOW,
    query: { period: 'week', dim: 'project', includeIdle: false, ...query } });
const board = (r: ReturnType<typeof recap> | null, bucket: string | null = null) => renderToStaticMarkup(createElement(RecapBoard, {
  result: r, view: DEFAULT_RECAP_VIEW, onView: vi.fn(), bucket, onBucket: vi.fn(), today: '2026-11-08', minDay: '2026-10-01', projectColors: {} }));

describe('format', () => {
  it('时长、百分比、柱顶简写、y 轴刻度', () => {
    expect([hm(0), hm(59 * MIN + 31_000), hm(80 * HOUR + 5 * MIN)]).toEqual(['00:00', '01:00', '80:05']);
    expect(pct(312)).toBe('31.2');
    expect([hoursLabel(7.46 * HOUR), hoursLabel(156.4 * HOUR)]).toEqual(['7.5h', '156h']);
    expect(yTicks(0)).toEqual({ top: HOUR, ticks: [0, HOUR] });
    expect(yTicks(11 * HOUR).ticks.at(-1)).toBe(12 * HOUR);
  });
  it('增减：▲ / ▼ / 持平；时长按分钟比；主线按百分点', () => {
    expect(delta(0, String)).toEqual({ text: '持平', dir: 'flat' });
    expect(delta(-2, String, ' 张')).toEqual({ text: '▼ 2 张', dir: 'dn' });
    expect(msDelta(HOUR + 20_000, HOUR)).toEqual({ text: '持平', dir: 'flat' });
    expect(pointDelta(312, 270).text).toBe('▲ 4.2 个百分点');
  });
  it('超过上限才折叠；按桶只留那几天', () => {
    expect(collapse([1, 2, 3], 3, false)).toEqual({ shown: [1, 2, 3], hidden: 0, overflow: false });
    expect(collapse([1, 2, 3, 4], 3, false)).toEqual({ shown: [1, 2, 3], hidden: 1, overflow: true });
    expect(collapse([1, 2, 3, 4], 3, true).shown).toHaveLength(4);
    const b = { id: '2026-11-03', days: ['2026-11-03'] } as never;
    expect(inBucket([{ day: '2026-11-03' }, { day: '2026-11-04' }], b)).toEqual([{ day: '2026-11-03' }]);
  });
});

describe('RecapBoard', () => {
  it('还没查出来时显示「正在统计…」', () => expect(board(null)).toContain('正在统计'));
  it('空周期：明细写「这个周期没有计时记录」', () => {
    expect(board(recap({}, []))).toContain('这个周期没有计时记录');
  });
  it('上一期可比时每张卡底部写「较上周 ▲ …」，明细有增减列', () => {
    const html = board(recap());
    expect(html).toContain('较上周 <b class="up">▲ 01:00</b>');
    expect(html).toContain('rv-bd cmp');
  });
  it('上一期早于最早的记录：写「较上周 —」，明细不显示增减', () => {
    const html = board(recap({}, undefined, [], '2026-11-03'));
    expect(html).toContain('较上周 <b>—</b>');
    expect(html).not.toContain('rv-bd cmp');
    expect(footnotes(recap({}, undefined, [], '2026-11-03'), DEFAULT_RECAP_VIEW, '2026-11-08', false)[0]).toContain('早于最早的记录');
  });
  it('筛选某一桶：标题右端出现「已筛选」，完成的卡只留那一天', () => {
    const cards = [done(1), done(2)];
    const r = recap({ bucket: '2026-11-03' }, undefined, cards);
    const html = board(r, '2026-11-03');
    expect(html).toContain('已筛选 11.03 周二');
    expect(html).toContain('11.03 周二 · 1 张');
  });
});

describe('DoneNotes', () => {
  const list = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, content: `卡${i}`, task: '支线', track: '支线' as const, day: '2026-11-03', at: t(11, 3, 18), ms: HOUR }));
  const render = (mode: 'card' | 'list', expanded = false) => renderToStaticMarkup(createElement(DoneNotes, {
    done: list, notes: [], scope: '本周', mode, onMode: vi.fn(), more: { done: expanded, notes: false }, onMore: vi.fn() }));
  it('卡片超过 6 张时只显示 6 张，底部出现「还有 2 张 · 展开全部」', () => {
    const html = render('card');
    expect(html.match(/rv-qc rv-dc/g)).toHaveLength(6);
    expect(html).toContain('还有 2 张 · 展开全部 8 张');
  });
  it('列表模式上限 10 行：8 行不折叠；展开后写「收起」', () => {
    expect(render('list')).not.toContain('rv-more');
    expect(render('card', true)).toContain('收起，只看最近 6 张');
  });
  it('没有笔记时写空状态', () => expect(render('card')).toContain('本周没有留下「做到哪了」'));
});
