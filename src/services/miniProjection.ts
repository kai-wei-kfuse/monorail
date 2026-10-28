import type { MiniSnapshot } from '../platform/windowBus';
import type { Snapshot } from './commit';

export function projectMini(snapshot: Snapshot): MiniSnapshot {
  const { home, cards, settings } = snapshot;
  const card = cards.find(card => card.id === home.card?.id);
  return structuredClone({ revision: home.dataVersion, entryId: home.entry?.id ?? null, cardId: home.card?.id ?? null,
    pending_id: home.pending?.id ?? null, entry: home.entry, pending: home.pending, resumeDescription: home.resumeDescription,
    card: card && home.card ? { id: card.id, content: card.content, status: home.card.status, project: card.project, tags: card.tags,
      goalMinutes: home.card.goalMinutes } : null,
    closedEffectiveMs: home.closedEffectiveMs, currentSegStartedAt: home.currentSegStartedAt, awayActivity: home.awayActivity,
    projects: snapshot.backpack.pool.projects, knownTags: home.knownTags, accent: settings.accent });
}
