// 0.3.0-beta.3 E8a2：操作历史的语义比较与主体 / 连带划分。
import { describe, expect, it } from 'vitest';
import type { TimeEntry } from '../timeline/entry';
import type { Card } from '../card/card';
import { compareAll, splitSubject } from './compare';
import type { CompareInput } from './compare';
import { defaults } from '../../shared/settings';

const t = (h: number, m = 0) => new Date(2026, 10, 4, h, m).toISOString();
const entry = (extra: Partial<TimeEntry> = {}): TimeEntry => ({ id: 'e1', started_at: t(15), ended_at: t(15, 30), description: '写周报', project: '工作',
  tags: [], card_id: null, kind: '普通', source: '日历', updated_at: t(15, 30), ...extra });
const card = (extra: Partial<Card> = {}): Card => ({ id: 'c1', source_record_id: null, content: '查服务器', created_at: t(9), due_at: null, blocking: false,
  task_id: 't1', project: null, tags: [], status: '待做', type: '结果卡', order: 1, timebox_minutes: null, no_shrink: false, shrunk_from: null, shrink_level: 0,
  continued_from: null, skip_count: 0, completed_at: null, completed_day: null, completed_track: null, progress_note: '', ...extra } as Card);
const base = (): CompareInput => ({ cards: [], tasks: [], reviews: [], records: [], entries: { before: [], after: [] },
  state: { before: { current_card: null, open_entry: 'x', pending_id: null }, after: { current_card: null, open_entry: 'x', pending_id: null } },
  settings: { before: structuredClone(defaults) as never, after: structuredClone(defaults) as never },
  names: { tasks: new Map([['t1', '找工作']]), cards: new Map([['c1', '查服务器']]), entries: new Map() } });

describe('compareAll', () => {
  it('0.3.0-beta.4 D2：完成想法显示「活跃池 → 已完成」，不显示成冷库', () => {
    const idea = { id: 'r1', text: '试试新咖啡', kind: '想法', created_at: t(9), due_at: null, blocking: false, task_id: null, card_id: null, tags: [],
      attachments: [], needs: null, pool: '活跃池', last_touched_at: t(9), cold_since: null } as const;
    const done = { ...idea, pool: '冷库' as const, cold_since: t(10), completed_at: t(10), completed_by: { kind: 'manual' as const, agent: null }, last_touched_at: t(10) };
    expect(compareAll({ ...base(), records: [{ id: 'r1', before: { ...idea, tags: [], attachments: [] }, after: { ...done, tags: [], attachments: [] } }] }))
      .toEqual([{ type: 'record', id: 'r1', name: '试试新咖啡', field: '池', before: '活跃池', after: '已完成' }]);
  });
  it('新建条目：改前都是 null；删除：改后都是 null', () => {
    const created = compareAll({ ...base(), entries: { before: [], after: [entry()] } });
    expect(created.map(c => [c.field, c.before, c.after])).toEqual([['描述', null, '写周报'], ['项目', null, '工作'], ['标签', null, '（无标签）'],
      ['时间', null, '11.04 15:00–15:30'], ['类型', null, '普通'], ['卡', null, '（无）']]);
    const removed = compareAll({ ...base(), entries: { before: [entry()], after: [] } });
    expect(removed.every(c => c.after === null && c.before !== null)).toBe(true);
  });
  it('只记变了的字段；跨日移动按 id 认得出来', () => {
    const moved = compareAll({ ...base(), entries: { before: [entry()], after: [entry({ started_at: t(14), ended_at: t(14, 30), updated_at: t(16) })] } });
    expect(moved).toEqual([{ type: 'entry', id: 'e1', name: '写周报', field: '时间', before: '11.04 15:00–15:30', after: '11.04 14:00–14:30' }]);
  });
  it('只动了簿记字段（updated_at、pending、open_entry_day）不算实质改动', () => {
    const input = base();
    input.entries = { before: [entry()], after: [entry({ updated_at: t(18) })] };
    input.state.after = { ...input.state.after, pending_id: 'p', open_entry_day: '2026-11-04' };
    input.cards = [{ id: 'c1', before: card(), after: { ...card(), progress_noted_at: t(10) } }];
    expect(compareAll(input)).toEqual([]);
  });
  it('卡片、计时状态、设置都按字段显示；设置的 lists 拆到子项', () => {
    const input = base();
    input.cards = [{ id: 'c1', before: card(), after: card({ status: '进行中' }) }];
    input.state.after = { ...input.state.after, current_card: 'c1' };
    input.settings.after = { ...defaults, alwaysOnTop: true, lists: { ...defaults.lists, tags: ['408'] } } as never;
    expect(compareAll(input).map(c => [c.type, c.field, c.before, c.after])).toEqual([
      ['card', '状态', '待做', '进行中'], ['state', '当前卡', '（无）', '查服务器'],
      ['settings', '置顶', '关', '开'], ['settings', '标签', '（空）', '408'],
    ]);
  });
});

describe('splitSubject', () => {
  it('主体那个对象的改动进 changes，其余进 effects；条目主体带项目和时间小字', () => {
    const all = compareAll({ ...base(), entries: { before: [], after: [entry()] }, cards: [{ id: 'c1', before: card(), after: card({ status: '已完成' }) }] });
    const r = splitSubject(all, { type: 'entry', id: 'e1' }, { entries: new Map([['e1', entry()]]), cards: new Map(), taskNames: new Map() });
    expect(r.subject).toEqual({ type: 'entry', id: 'e1', text: '写周报', meta: '工作 · 11.04 15:00–15:30' });
    expect(r.changes.every(c => c.type === 'entry')).toBe(true);
    expect(r.effects.map(c => [c.type, c.field])).toEqual([['card', '状态']]);
  });
  it('没有主体时全部算 changes', () => {
    const all = compareAll({ ...base(), entries: { before: [], after: [entry()] } });
    expect(splitSubject(all, null, { entries: new Map(), cards: new Map(), taskNames: new Map() })).toEqual({ subject: null, changes: all, effects: [] });
  });
});
