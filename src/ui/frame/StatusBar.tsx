import type { ReactNode } from 'react';
import './frame.css';

/** 底栏骨架：左边放快捷活动开关，右边放底线标记、保存提示等。内容由外壳决定。 */
export function StatusBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return <footer className="dock">{left}<div className="dock-right">{right}</div></footer>;
}

/** 整个窗口的三段网格：标题栏 / 内容区 / 底栏。 */
export function Frame({ titleBar, statusBar, children }: { titleBar: ReactNode; statusBar: ReactNode; children: ReactNode }) {
  return <div className="frame">{titleBar}<main className="frame-stage">{children}</main>{statusBar}</div>;
}
