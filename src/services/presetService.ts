import type { Ctx } from './commit';
import { run } from './commit';
import * as tracking from './tracking/api';
import type { FavoriteValue } from './tracking/api';
import type { HistorySource } from '../shared/history';

// 设为收藏、新建项目和标签也会从日历和列表发起：调用方传 source 记页面（缺省按前缀记设置页）
const via = (source: HistorySource | undefined) => (source ? { source } : {});
export const addFavorite = (ctx: Ctx, value: FavoriteValue, at: string) => run(ctx, tx => tracking.addFavoriteInTx(tx, value), at, { action: 'preset.addFavorite' });
export const favorite = (ctx: Ctx, entryId: string, at: string, source?: HistorySource) =>
  run(ctx, tx => tracking.favoriteInTx(tx, entryId), at, { action: 'preset.favorite', ...via(source) });
export const editFavorite = (ctx: Ctx, id: string, value: FavoriteValue, at: string) => run(ctx, tx => tracking.editFavoriteInTx(tx, id, value), at, { action: 'preset.editFavorite' });
export const removeFavorite = (ctx: Ctx, id: string, at: string) => run(ctx, tx => tracking.removeFavoriteInTx(tx, id), at, { action: 'preset.removeFavorite' });
export const reorderFavorites = (ctx: Ctx, ids: string[], at: string) => run(ctx, tx => tracking.reorderFavoritesInTx(tx, ids), at, { action: 'preset.reorderFavorites' });
export const createProject = (ctx: Ctx, name: string, at: string, source?: HistorySource) =>
  run(ctx, tx => tracking.createProjectInTx(tx, name), at, { action: 'preset.createProject', ...via(source) });
export const createTag = (ctx: Ctx, name: string, at: string, source?: HistorySource) =>
  run(ctx, tx => tracking.createTagInTx(tx, name), at, { action: 'preset.createTag', ...via(source) });
