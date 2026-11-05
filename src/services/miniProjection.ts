import type { MiniSnapshot } from '../platform/windowBus';
import type { SuggestData } from '../shared/suggest';
import type { Snapshot } from './commit';
import { suggestSource } from './suggestSource';

/** 小窗最近的记录最多发这么多条（去重后）：每秒心跳都发，不发一年的全部条目（0.3.0-beta.4 D1）。 */
export const MINI_RECENT_LIMIT = 100;
// 心跳每秒拿同一份快照投影一次：自动完成数据按快照对象缓存，只在提交后重算
const suggestCache = new WeakMap<Snapshot, SuggestData>();
function miniSuggest(snapshot: Snapshot): SuggestData {
  let value = suggestCache.get(snapshot);
  if (!value) {
    value = suggestSource({ presets: snapshot.settings.lists.presets, cards: snapshot.cards, tasks: snapshot.tasks, entries: snapshot.entries }, MINI_RECENT_LIMIT);
    suggestCache.set(snapshot, value);
  }
  return value;
}

/** epoch 是主窗口会话世代（Ctx.mainEpoch），revision 是这个会话里的提交序号。 */
export function projectMini(snapshot: Snapshot, epoch: number): MiniSnapshot {
  const { home, cards, settings } = snapshot;
  const card = cards.find(card => card.id === home.card?.id);
  return structuredClone({ epoch, revision: home.dataVersion, entryId: home.entry?.id ?? null, cardId: home.card?.id ?? null,
    pending_id: home.pending?.id ?? null, entry: home.entry, pending: home.pending, resumeDescription: home.resumeDescription,
    card: card && home.card ? { id: card.id, content: card.content, status: home.card.status, project: card.project, tags: card.tags,
      goalMinutes: home.card.goalMinutes } : null,
    closedEffectiveMs: home.closedEffectiveMs, currentSegStartedAt: home.currentSegStartedAt, awayActivity: home.awayActivity,
    projects: snapshot.backpack.pool.projects, knownTags: home.knownTags, accent: settings.accent, miniMode: settings.miniMode,
    suggest: miniSuggest(snapshot) });
}
