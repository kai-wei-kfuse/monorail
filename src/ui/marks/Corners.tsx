import type { ReactNode, Ref } from 'react';
import './marks.css';

/** L 形角标：只框左上和右下两角，外侧拐角各压一个 7×7 黑方块；角标伸进左边距，文字和上方项目名对齐。 */
export function Corners({ children, boxRef }: { children: ReactNode; boxRef?: Ref<HTMLDivElement> }) {
  return <div className="tbox" ref={boxRef}>
    <i className="br tl" data-fx="corner-tl" />
    {children}
    <i className="br bk" data-fx="corner-bk" />
  </div>;
}
