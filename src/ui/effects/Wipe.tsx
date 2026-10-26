import { useEffect, useRef } from 'react';
import { motionLevel, play } from './animate';
import { decode } from './decode';
import './effects.css';

/**
 * 整屏擦除（UI风格规范 §8.3）。挂载即播放：色块从左盖住卡片 → onCovered（调用方在底下换内容）→
 * 停 420ms → 向右退出 → onDone（调用方卸载它，并让新标题升起、竖条再弹一次）。
 * 非「完整」动效等级下立即依次回调 onCovered、onDone。
 */
export function Wipe({ no, en = 'NEXT CARD', cn = '再抽一张', meta, title, onCovered, onDone }:
  { no: string; en?: string; cn?: string; meta: string; title: string; onCovered: () => void; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef({ onCovered, onDone });
  cb.current = { onCovered, onDone };
  useEffect(() => {
    const w = ref.current!;
    if (motionLevel() !== 'full') { cb.current.onCovered(); cb.current.onDone(); return; }
    let covered = false;
    const cover = play(w, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 300, ease: 'snap' })!;
    const parts = [
      cover,
      play(w.querySelector('.w-no'), [{ transform: 'translateX(24%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 460, delay: 90 }),
      play(w.querySelector('.w-side'), [{ transform: 'translateX(-20px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, delay: 180 }),
      play(w.querySelector('.w-bars'), [{ transform: 'scaleX(0)' }, { transform: 'none' }], { duration: 500, delay: 60, ease: 'snap' }),
    ];
    const stop = decode(w.querySelector('.k'), 180);
    let off: Animation | null = null;
    // 被打断（卸载）时：如果还没盖住，直接完成换卡（§8.3 第 6 条）
    const finishCover = () => { if (!covered) { covered = true; cb.current.onCovered(); } };
    cover.onfinish = () => {
      finishCover();
      off = play(w, [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 0 100%)' }], { duration: 320, delay: 420, ease: 'snap', fill: 'forwards' });
      if (off) off.onfinish = () => cb.current.onDone();
    };
    return () => { stop(); parts.forEach(a => a?.cancel()); off?.cancel(); finishCover(); };
  }, []);
  const cnNo = /[^\x20-\x7e]/.test(no);
  return <div className="fx"><div className="wipe" ref={ref}>
    <i className="w-bars" />
    <b className={`w-no${cnNo ? ' cn' : ''}`}>{no}</b>
    <div className="w-side"><span className="k">{en}<em>{cn}</em></span><strong>{meta}</strong><span className="w-t">{title}</span></div>
  </div></div>;
}
