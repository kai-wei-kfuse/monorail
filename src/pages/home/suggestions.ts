// 计时条自动完成的候选（原型 home.js 的 useEntry）：收藏、待做的卡、最近的记录，按输入筛选。

export interface SuggestFavorite { id: string; name: string; project: string; tags: string[] }
export interface SuggestCard { id: string; content: string; track: '主线' | '支线' }
export interface SuggestRecent { id: string; description: string; project: string; tags: string[] }
export interface SuggestData { favorites: SuggestFavorite[]; cards: SuggestCard[]; recent: SuggestRecent[] }

/** 最近的记录里不列这几个系统项目：选中它们「继续」没有意义。 */
const NOT_RECENT = new Set(['待机', '休息', '睡眠']);

/**
 * 按输入筛选，不分大小写，没写字时全列。卡最多 4 张；最近的记录按新到旧传进来，描述相同的只留最新一条，最多 5 条。
 * 卡的 content 是去掉 [词] 标记的纯文本。
 */
export function suggestions(query: string, data: SuggestData): SuggestData {
  const q = query.trim().toLowerCase(), hit = (s: string) => !q || s.toLowerCase().includes(q), seen = new Set<string>();
  return {
    favorites: data.favorites.filter(p => hit(p.name)),
    cards: data.cards.filter(c => hit(c.content)).slice(0, 4),
    recent: data.recent.filter(e => !NOT_RECENT.has(e.project) && !seen.has(e.description) && seen.add(e.description) && hit(e.description)).slice(0, 5),
  };
}
