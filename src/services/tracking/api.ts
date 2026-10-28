// All operations run inside the caller's transaction; this boundary never enqueues or reads cards.
import { refElapsed } from '../../domain/timeline/entry';
import type { EntryTemplate } from '../../domain/timeline/entry';
import { startInTx } from './timerService';
import { openInTx } from './transaction';
import type { TrackingTransaction } from './transaction';

export type { TrackingTransaction, TrackingState } from './transaction';
export type { EntryTemplate, TimeEntry } from '../../domain/timeline/entry';
export type { ReadoutRequest, ReadoutPlan } from '../../domain/timeline/edit';
export { inRange, overlaps } from '../../domain/timeline/query';
export { addFavoriteInTx, favoriteInTx, editFavoriteInTx, removeFavoriteInTx, reorderFavoritesInTx, createProjectInTx, createTagInTx } from './presetService';
export type { FavoriteValue } from './presetService';
export { openInTx } from './transaction';
export { startInTx, startSystemInTx, pauseInTx, stopInTx, insertInTx, resumeInTx, stopRefInTx, renameRefInTx, retagRefInTx } from './timerService';
export { settleOfflineInTx } from './timerService';
export { manualInTx, editInTx, deleteInTx, previewReadoutInTx, setReadoutInTx, setRefTotalInTx } from './timeEditService';
export { updateRangeInTx, moveInTx, copyInTx, patchMetadataInTx, setStartInTx, setEndInTx, setDurationInTx } from './timeEditService';
export const startRefInTx = (tx: TrackingTransaction, ref: string, template: EntryTemplate, from = tx.at) =>
  startInTx(tx, { ...template, card_id: ref }, from);
export const refElapsedInTx = (tx: Pick<TrackingTransaction, 'entries' | 'at'>, ref: string) => refElapsed(tx.entries, ref, tx.at);
export function activeRefInTx(tx: TrackingTransaction): string | null {
  const open = openInTx(tx);
  return open?.card_id ?? (open && open.kind !== '普通'
    ? tx.entries.find(entry => entry.id === tx.state.resume_entry_id)?.card_id ?? null : null);
}
