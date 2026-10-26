import { useEffect, useRef } from 'react';
import { play } from './animate';
import './effects.css';

/** 2px 黑线从父元素顶部划到底部（启动开场，§8.2）。挂载即播一次；非「完整」动效等级下不显示。 */
export function ScanLine({ delay = 80, duration = 560 }: { delay?: number; duration?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const a = play(ref.current, [{ top: '0%', opacity: 1 }, { top: '100%', opacity: .5 }], { duration, delay, ease: 'snap', fill: 'none' });
    return () => a?.cancel();
  }, [delay, duration]);
  return <div className="scan" ref={ref} aria-hidden="true" />;
}
