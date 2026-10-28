import type { ReactNode } from 'react';
import './layout.css';

/**
 * 日历、列表这类整页的外框（UI 规范 §11.6）：浅色面板，头部是大编号 + 英文小字 + 中文标题，右侧放工具；下面一段说明。
 * className 用来给页面加自己的布局（例如日历要让看板占满剩下的高度）。
 */
export function PageFrame({ no, en, cn, tools, desc, className = '', children }:
  { no: string; en: string; cn: string; tools?: ReactNode; desc?: ReactNode; className?: string; children: ReactNode }) {
  return <section className={`pg ${className}`.trim()}>
    <div className="s-head">
      <span className="s-no">{no}</span>
      <div><span className="k">{en}</span><h2>{cn}</h2></div>
      {tools && <div className="pg-tools">{tools}</div>}
    </div>
    {desc && <p className="s-desc">{desc}</p>}
    {children}
  </section>;
}
