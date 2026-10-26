import type { CSSProperties } from 'react';
import { useLayoutEffect, useRef } from 'react';
import './marks.css';

export type MeterState = 'ready' | 'run' | 'away' | 'over';
const LEAD = [.14, .2, .28, .38, .5, .64, .8];

/**
 * 进度竖条带：横穿卡片，两端各 7 根渐疏引导条（只是造型），中间 cells 个刻度格。
 * filled 是已用掉的格数（变成 --ink），当前格在进行中时闪烁，下方 ▲ 指着它。格数怎么映射由调用方决定。
 */
export function VBars({ cells = 60, filled, state, className = '', style }:
  { cells?: number; filled: number; state: MeterState; className?: string; style?: CSSProperties }) {
  const bars = useRef<HTMLDivElement>(null), ptr = useRef<HTMLSpanElement>(null);
  const k = Math.max(0, Math.min(cells, Math.floor(filled)));
  useLayoutEffect(() => {
    const ref = bars.current?.querySelectorAll<HTMLElement>('i:not(.lead)')[Math.min(k, cells - 1)];
    if (ref && ptr.current) ptr.current.style.left = ref.offsetLeft + ref.offsetWidth / 2 + 'px';
  });
  const lead = (g: number, key: string) => <i key={key} className="lead" style={{ '--g': g } as CSSProperties} />;
  return <div className={`meter ${className}`.trim()} data-state={state} style={style} aria-hidden="true">
    <div className="bars" ref={bars} data-fx="bars">
      {LEAD.map((g, i) => lead(g, 'l' + i))}
      {Array.from({ length: cells }, (_, i) => <i key={i}
        className={[i % 15 === 0 || i === cells - 1 ? 'q' : '', i < k ? 'on' : '', i === k ? 'now' : ''].filter(Boolean).join(' ') || undefined} />)}
      {[...LEAD].reverse().map((g, i) => lead(g, 'r' + i))}
    </div>
    <span className="ptr" ref={ptr} />
  </div>;
}

/** 悬浮小窗里的 30 格、5px 高的缩小版。 */
export function MiniBars({ cells = 30, filled }: { cells?: number; filled: number }) {
  const k = Math.max(0, Math.min(cells, Math.floor(filled)));
  return <div className="mbars" aria-hidden="true">{Array.from({ length: cells }, (_, i) => <i key={i} className={i < k ? 'on' : undefined} />)}</div>;
}
