import { useId } from 'react';
import './marks.css';

const RING = 'M58 26C68 23 82 27 85 36S80 54 68 57 40 58 35 50 38 30 58 26z';
const BIG = [2.3, 1.85, 1.45, 1.1, .78, .48], SMALL = [.5, .26];

/** ▽ 徽记：倒三角外框，上两角各一根短竖线，底尖下伸一根短线；三角里是被裁掉外圈的等高线。线宽由 strokeWidth 决定。 */
export function Emblem({ className, strokeWidth = 1.4 }: { className?: string; strokeWidth?: number }) {
  const clip = useId();
  return <svg className={`emblem ${className ?? ''}`.trim()} viewBox="0 0 120 112" aria-hidden="true">
    <defs><clipPath id={clip}><path d="M18 18h84L60 92z" /></clipPath></defs>
    <g fill="none" stroke="currentColor" strokeWidth={strokeWidth}>
      <path vectorEffect="non-scaling-stroke" d="M6 12h108L60 104z" />
      <path vectorEffect="non-scaling-stroke" d="M6 3v9M114 3v9M60 104v6" />
      <g clipPath={`url(#${clip})`}>
        {BIG.map(s => <path key={s} vectorEffect="non-scaling-stroke" transform={`translate(66 38) scale(${s}) translate(-60 -42)`} d={RING} />)}
        {SMALL.map(s => <path key={s} vectorEffect="non-scaling-stroke" transform={`translate(36 30) scale(${s}) translate(-60 -42) rotate(-20 60 42)`} d={RING} />)}
      </g>
    </g>
  </svg>;
}
