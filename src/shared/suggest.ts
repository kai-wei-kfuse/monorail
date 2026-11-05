// 计时条自动完成的数据形状（收藏、待做的卡、最近的记录）：主窗口计时条、小窗快照共用（0.3.0-beta.4 D1）。

export interface SuggestFavorite { id: string; name: string; project: string; tags: string[] }
export interface SuggestCard { id: string; content: string; track: '主线' | '支线' }
export interface SuggestRecent { id: string; description: string; project: string; tags: string[] }
export interface SuggestData { favorites: SuggestFavorite[]; cards: SuggestCard[]; recent: SuggestRecent[] }

/** 最近的记录里不列这几个系统项目：选中它们「继续」没有意义。 */
export const NOT_RECENT: ReadonlySet<string> = new Set(['待机', '休息', '睡眠']);
