// 计时条要显示的东西从 store 里取（N3 接线草案 app/evidence/n3-contracts.md）。
import type { Settings } from '../../shared/settings';
import type { Projection } from '../../store/appStore';
import type { HomeSlice } from '../../store/homeSlice';
import type { TaskView } from '../../store/backpackSlice';
import { suggestSource } from '../../services/suggestSource';
import type { FavoriteView } from './PresetRow';
import type { TimerView } from './TimerBar';

type Card = Projection['cards'][number];
type TimeEntry = Projection['entries'][number];

/** projects 用任务池投影里的（系统五项、未分类和自定义项目，带颜色）；已知标签用 home.knownTags（按使用次数排）。 */
export interface TimerSource { home: HomeSlice; entries: readonly TimeEntry[]; cards: readonly Card[]; tasks: readonly TaskView[]; settings: Settings; projects: readonly { name: string; color: string }[] }

export function timerView({ home, entries, cards, tasks, settings, projects }: TimerSource): TimerView {
  const isAway = home.entry?.kind === '插入';
  const away = isAway ? home.entry : null;
  const baseEntry = isAway ? (home.resumeEntry ?? null) : home.entry;
  return {
    entry: baseEntry, away, idle: !baseEntry || baseEntry.project === '待机', looseIdle: home.looseIdle, pending: home.pending,
    paused: isAway ? null : home.resumeDescription,
    waitingCard: home.card?.status === '待做', canDraw: !home.card && home.mode !== 'rest',
    projects: [...projects], knownTags: home.knownTags,
    // 自动完成：与小窗同一来源（services/suggestSource，0.3.0-beta.4 D1）
    suggest: suggestSource({ presets: settings.lists.presets, cards, entries,
      tasks: tasks.map(t => ({ id: t.id, slot: t.slot })) }),
  };
}

/** 收藏：位置是计时条的预设，按列表顺序。 */
export function favorites(settings: Settings): FavoriteView[] {
  const color = (p: string) => settings.lists.projects.find(x => x.name === p)?.color ?? 'var(--mute-2)';
  return settings.lists.presets.filter(p => p.place === '计时条').map(p => ({ id: p.id, name: p.name, project: p.project, color: color(p.project), tags: p.tags }));
}
