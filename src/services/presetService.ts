import type { Ctx } from './commit';
import { run } from './commit';
import * as tracking from './tracking/api';
import type { FavoriteValue } from './tracking/api';

export const addFavorite = (ctx: Ctx, value: FavoriteValue, at: string) => run(ctx, tx => tracking.addFavoriteInTx(tx, value), at);
export const favorite = (ctx: Ctx, entryId: string, at: string) => run(ctx, tx => tracking.favoriteInTx(tx, entryId), at);
export const editFavorite = (ctx: Ctx, id: string, value: FavoriteValue, at: string) => run(ctx, tx => tracking.editFavoriteInTx(tx, id, value), at);
export const removeFavorite = (ctx: Ctx, id: string, at: string) => run(ctx, tx => tracking.removeFavoriteInTx(tx, id), at);
export const reorderFavorites = (ctx: Ctx, ids: string[], at: string) => run(ctx, tx => tracking.reorderFavoritesInTx(tx, ids), at);
export const createProject = (ctx: Ctx, name: string, at: string) => run(ctx, tx => tracking.createProjectInTx(tx, name), at);
