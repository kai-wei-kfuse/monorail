import type { MouseEvent } from 'react';
import { Icon } from '../../ui/icons/Icon';
import { suggestions } from './suggestions';
import type { SuggestData } from './suggestions';

const meta = (project: string, tags: string[]) => project + tags.map(t => ' #' + t).join('');
const Group = ({ cn, en }: { cn: string; en: string }) => <li className="sug-h" role="presentation"><b>{cn}</b><span>{en}</span></li>;

/**
 * 计时条输入框下面的自动完成（UI 规范 §11.2）：收藏、待做的卡、最近的记录。
 * 用 mousedown 选，输入框不会先失焦；选中以后由计时条决定怎么离开这一组。
 */
export function Suggest({ query, data, onFavorite, onCard, onRecent }:
  { query: string; data: SuggestData; onFavorite: (id: string) => void; onCard: (id: string) => void; onRecent: (id: string) => void }) {
  const { favorites, cards, recent } = suggestions(query, data);
  const choose = (fn: () => void) => (e: MouseEvent) => { e.preventDefault(); fn(); };
  return <ul className="sug sel-pop" role="listbox" aria-label="自动完成">
    {favorites.length > 0 && <>
      <Group cn="收藏" en="FAVORITES" />
      {favorites.map(p => <li key={p.id} className="sug-i" role="option" aria-selected={false} onMouseDown={choose(() => onFavorite(p.id))}>
        <Icon name="pin" /><span>{p.name}</span><em>{meta(p.project, p.tags)}</em></li>)}
    </>}
    <Group cn="待做的卡" en="CARDS · 选中 = 开始这张卡" />
    {cards.map(c => <li key={c.id} className="sug-i" role="option" aria-selected={false} onMouseDown={choose(() => onCard(c.id))}>
      <Icon name="cards" /><span>{c.content}</span><em>{c.track}任务</em></li>)}
    {!cards.length && <li className="sug-none" role="presentation">没有匹配的卡</li>}
    <Group cn="最近的记录" en="RECENT · 选中 = 继续" />
    {recent.map(e => <li key={e.id} className="sug-i" role="option" aria-selected={false} onMouseDown={choose(() => onRecent(e.id))}>
      <Icon name="play" /><span>{e.description}</span><em>{meta(e.project, e.tags)}</em></li>)}
    <li className="sug-foot" role="presentation">写 #标签、@项目。写了字，回车或点别处就写盘；没写字就离开，接着计「待确认」；Esc 放弃</li>
  </ul>;
}
