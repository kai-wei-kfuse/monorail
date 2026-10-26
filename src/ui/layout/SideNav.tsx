import type { ReactNode } from 'react';
import './layout.css';

export interface NavItem { id: string; no: string; cn: string; en: string; count?: number }

/** 左侧导航：顶部英文 + 中文，每行「编号 中文 英文」，选中的黑底并伸出一个小三角。 */
export function SideNav({ en, cn, items, active, onSelect, foot }:
  { en: string; cn: string; items: NavItem[]; active: string; onSelect: (id: string) => void; foot?: ReactNode }) {
  return <nav className="s-nav">
    <div className="s-nav-head"><span className="k">{en}</span><b>{cn}</b></div>
    <ul className="s-list">
      {items.map(it => <li key={it.id}>
        <button type="button" className="s-item" aria-current={it.id === active ? 'page' : undefined} onClick={() => onSelect(it.id)}>
          <span className="no">{it.no}</span><b>{it.cn}</b>{it.count !== undefined ? <i className="cnt">{it.count}</i> : <i>{it.en}</i>}
        </button>
      </li>)}
    </ul>
    {foot && <div className="s-nav-foot">{foot}</div>}
  </nav>;
}

/** 左导航 + 右面板的两栏骨架。 */
export function SplitLayout({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return <section className="split">{nav}<div className="s-panel">{children}</div></section>;
}
