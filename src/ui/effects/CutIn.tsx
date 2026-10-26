import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { play } from './animate';
import { decode } from './decode';
import './effects.css';

/**
 * 强调色斜带横幅（UI风格规范 §8.4），现在只用于「目标达成」。挂载即播放：从中线张开 → 大字滑入 →
 * 停 hold 毫秒 → 向右甩出 → onDone。dim 是要压暗到 .16 的卡片内容。
 * 只在首页可见且动效为「完整」时由调用方挂载；其他情况调用方改发通知。
 */
export function CutIn({ cn, en, sub, hold = 1100, dim, onDone }:
  { cn: ReactNode; en: string; sub: string; hold?: number; dim?: Element | null; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const ci = ref.current!, out = 220 + hold;
    const list = [
      play(dim, [{ opacity: 1 }, { opacity: .16, offset: .16 }, { opacity: .16, offset: .8 }, { opacity: 1 }], { duration: out + 420, easing: 'linear', fill: 'none' }),
      play(ci, [{ clipPath: 'inset(50% 0 50% 0)' }, { clipPath: 'inset(-30px 0 -20px 0)' }], { duration: 230, ease: 'snap' }),
      play(ci.querySelector('.ci-cn'), [{ transform: 'translateX(16%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 440, delay: 60 }),
      play(ci.querySelector('.ci-bars'), [{ transform: 'scaleX(0)' }, { transform: 'none' }], { duration: 380, delay: 110 }),
      play(ci.querySelector('.ci-side'), [{ transform: 'translateX(-24px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, delay: 200 }),
    ];
    const fling = play(ci, [{ transform: 'skewY(-3deg)' }, { transform: 'translateX(106%) skewY(-3deg)' }], { duration: 300, delay: out, ease: 'fling', fill: 'forwards' });
    const stop = decode(ci.querySelector('.ci-en'), 200);
    if (fling) fling.onfinish = () => done.current(); else done.current();
    return () => { stop(); [...list, fling].forEach(a => a?.cancel()); };
  }, [dim, hold]);
  return <div className="fx"><div className="ci" ref={ref}><div className="ci-in">
    <i className="ci-bars" /><b className="ci-cn">{cn}</b>
    <div className="ci-side"><span className="ci-en">{en}</span><small>{sub}</small></div>
  </div></div></div>;
}
