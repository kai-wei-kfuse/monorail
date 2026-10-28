import { describe, expect, it } from 'vitest';
import { defaults } from '../../shared/settings';
import type { Projection } from '../../store/appStore';
import { initialHome } from '../../store/homeSlice';
import type { HomeSlice } from '../../store/homeSlice';
import { timerView } from './timerView';
import type { TimerSource } from './timerView';

type Entry = Projection['entries'][number];
const entry = (id: string, description: string, project: string, start: string, end: string | null, kind: Entry['kind'] = '普通'): Entry =>
  ({ id, description, project, tags: [], card_id: null, kind, source: '计时', started_at: start, ended_at: end, updated_at: start });
const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
const settings = structuredClone(defaults);
settings.lists.presets = [{ id: 'p1', name: '学 408', project: '学习', tags: ['408'], mode: '切换', place: '计时条' },
  { id: 'p2', name: '厕所', project: '生活', tags: [], mode: '插入', place: '弹层' }];
const source = (home: Partial<HomeSlice>, entries: Entry[] = [], more: Partial<TimerSource> = {}): TimerSource =>
  ({ home: { ...initialHome, ...home }, entries, cards: [], tasks: [], settings, projects: [], ...more });
const asEntry = (e: Entry): HomeSlice['entry'] => ({ id: e.id, description: e.description, project: e.project, tags: e.tags, startedAt: e.started_at,
  cardId: e.card_id, paused: e.kind === '暂停', kind: e.kind });

describe('timerView', () => {
  it('待机：idle，没有暂停目标；没卡时可以抽卡', () => {
    const idle = entry('i', '待机', '待机', t(9), null);
    const v = timerView(source({ entry: asEntry(idle) }, [idle]));
    expect([v.idle, v.paused, v.canDraw, v.waitingCard]).toEqual([true, null, true, false]);
  });
  it('暂停：继续的那件事取 homeSlice 的回到目标', () => {
    const pause = entry('d', '待机', '待机', t(10), null, '暂停');
    expect(timerView(source({ entry: asEntry(pause), resumeDescription: '写周报' }, [pause])).paused).toBe('写周报');
  });
  it('收藏只取位置是计时条的预设；最近的条目新到旧', () => {
    const a = entry('a', '学 408', '学习', t(8), t(9)), c = entry('c', '写周报', '工作', t(9, 10), null);
    const v = timerView(source({ entry: asEntry(c) }, [a, c]));
    expect(v.suggest.favorites.map(f => f.name)).toEqual(['学 408']);
    expect(v.suggest.recent.map(e => e.id)).toEqual(['c', 'a']);
  });
  it('有卡时不能再抽；抽到的卡在等开始；卡按任务分主线、支线', () => {
    const card = { id: 'k', content: '改 [简历]', status: '待做', task_id: 'm' } as Projection['cards'][number];
    const v = timerView(source({ card: { ...initialHome.card!, id: 'k', status: '待做' } as HomeSlice['card'] }, [],
      { cards: [card], tasks: [{ id: 'm', name: '求职', slot: '主线', slotIndex: 1 } as TimerSource['tasks'][number]] }));
    expect([v.canDraw, v.waitingCard]).toEqual([false, true]);
    expect(v.suggest.cards).toEqual([{ id: 'k', content: '改 简历', track: '主线' }]);
  });
});
