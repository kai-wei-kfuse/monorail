import type { ReactNode } from 'react';
import './layout.css';

/** 一行选项：左边名称和说明，右边控件，最小高度 64px。 */
export function Row({ title, desc, children }: { title: ReactNode; desc?: ReactNode; children?: ReactNode }) {
  return <div className="row" data-fx="row">
    <div className="r-l"><b>{title}</b>{desc && <p>{desc}</p>}</div>
    <div className="ctl">{children}</div>
  </div>;
}
