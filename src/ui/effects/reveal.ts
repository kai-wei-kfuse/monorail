// 首页常用的几段演出：标题升起、竖条弹起、数字乱跳（UI风格规范 §8.2、§8.3）。
import { motionLevel, play } from './animate';

/** 每一行从遮罩里升起，行间隔 110ms。 */
export function revealLines(lines: Iterable<Element>, delay = 0) {
  return [...lines].map((l, i) => play(l, [
    { clipPath: 'inset(0 0 100% 0)', transform: 'translateY(.35em)' },
    { clipPath: 'inset(-20% -4% -20% -4%)', transform: 'none' },
  ], { duration: 560, delay: delay + i * 110 }));
}

/** 每根竖条从底部弹起，从左到右每根晚 6ms，像一道波。 */
export function popBars(bars: Iterable<Element>, delay = 0) {
  return [...bars].map((b, i) => play(b, [{ transform: 'scaleY(0)' }, { transform: 'none' }], { duration: 300, delay: delay + i * 6, ease: 'snap' }));
}

/** 数字先随机乱跳（每 45ms 换一次），dur 后交还给 onDone 写回真实值。返回取消函数。 */
export function scrambleDigits(el: HTMLElement | null, delay: number, dur: number, onDone: () => void): () => void {
  if (!el || motionLevel() !== 'full') { onDone(); return () => {}; }
  const t0 = performance.now() + delay, end = t0 + dur, rnd = () => Math.floor(Math.random() * 10);
  let last = 0, id = 0;
  const step = (now: number) => {
    if (now >= end) { onDone(); return; }
    if (now >= t0 && now - last > 45) { last = now; el.textContent = `${rnd()}${rnd()}:${rnd()}${rnd()}`; }
    id = requestAnimationFrame(step);
  };
  id = requestAnimationFrame(step);
  return () => { cancelAnimationFrame(id); onDone(); };
}
