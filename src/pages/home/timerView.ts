// 计时条要显示的东西从 store 里取（N3 接线草案 app/evidence/n3-contracts.md）。
import type { Settings } from '../../shared/settings';
import type { Projection } from '../../store/appStore';
import type { HomeSlice } from '../../store/homeSlice';
import type { TaskView } from '../../store/backpackSlice';
import { plainText } from '../../ui/marks/MarkedText';
import type { FavoriteView } from './PresetRow';
import type { TimerView } from './TimerBar';

type Card = Projection['cards'][number];
type TimeEntry = Projection['entries'][number];

export interface TimerSource { home: HomeSlice; entries: readonly TimeEntry[]; cards: readonly Card[]; tasks: readonly TaskView[]; settings: Settings }

/**
 * 暂停中点「继续」会接着计的那件事。暂停是一条待机（kind 暂停），回到目标没有投影出来，
 * 先取暂停开始前最后结束的那条普通条目（pauseInTx 只在普通条目上记回到目标）。
 */
function pausedTarget(home: HomeSlice, entries: readonly TimeEntry[]): string | null {
  const e = home.entry;
  if (!e || e.project !== '待机' || e.kind !== '暂停') return null;
  const at = Date.parse(e.startedAt);
  const before = entries.filter(x => x.kind === '普通' && x.project !== '待机' && x.ended_at !== null && Date.parse(x.ended_at) <= at)
    .sort((a, b) => Date.parse(b.ended_at!) - Date.parse(a.ended_at!));
  return before[0]?.description ?? null;
}

export function timerView({ home, entries, cards, tasks, settings }: TimerSource): TimerView {
  const track = (c: Card) => tasks.find(t => t.id === c.task_id)?.slot === '主线' ? '主线' as const : '支线' as const;
  return {
    entry: home.entry, idle: home.entry?.project === '待机', pending: home.pending, paused: pausedTarget(home, entries),
    waitingCard: home.card?.status === '待做', canDraw: !home.card && home.mode !== 'rest',
    projects: settings.lists.projects, knownTags: settings.lists.tags,
    suggest: {
      favorites: favorites(settings).map(f => ({ id: f.id, name: f.name, project: f.project, tags: f.tags })),
      cards: cards.filter(c => c.status === '待做').map(c => ({ id: c.id, content: plainText(c.content), track: track(c) })),
      recent: [...entries].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
        .map(e => ({ id: e.id, description: e.description, project: e.project, tags: e.tags })),
    },
  };
}

/** 收藏：位置是计时条的预设，按列表顺序。 */
export function favorites(settings: Settings): FavoriteView[] {
  const color = (p: string) => settings.lists.projects.find(x => x.name === p)?.color ?? 'var(--mute-2)';
  return settings.lists.presets.filter(p => p.place === '计时条').map(p => ({ id: p.id, name: p.name, project: p.project, color: color(p.project), tags: p.tags }));
}
