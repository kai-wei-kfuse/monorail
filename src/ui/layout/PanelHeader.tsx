import type { CSSProperties } from 'react';
import './layout.css';

const GROW = [.14, .2, .28, .38, .5, .64, .8, 1];

/** 面板标题：大编号 + 英文小字 + 中文标题，最右是越来越粗、越来越密的竖条；下面一段说明。 */
export function PanelHeader({ no, en, cn, desc }: { no: string; en: string; cn: string; desc?: string }) {
  return <>
    <div className="s-head">
      <span className="s-no" data-fx="no">{no}</span>
      <div><span className="k" data-fx="decode">{en}</span><h2>{cn}</h2></div>
      <span className="s-bars" data-fx="bars" aria-hidden="true">{GROW.map(g => <i key={g} style={{ '--g': g } as CSSProperties} />)}</span>
    </div>
    {desc && <p className="s-desc">{desc}</p>}
  </>;
}
