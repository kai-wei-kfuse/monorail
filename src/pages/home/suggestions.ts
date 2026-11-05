// 计时条自动完成的候选（原型 home.js 的 useEntry）：收藏、待做的卡、最近的记录，按输入筛选。

// 数据形状在 shared/suggest.ts，来源在 services/suggestSource.ts（主窗口计时条与小窗共用，0.3.0-beta.4 D1）。
import { NOT_RECENT } from '../../shared/suggest';
import type { SuggestData } from '../../shared/suggest';
export type { SuggestCard, SuggestData, SuggestFavorite, SuggestRecent } from '../../shared/suggest';

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
