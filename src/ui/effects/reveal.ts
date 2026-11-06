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

/** 随机数字仅覆盖在伪元素上，真实 textContent 始终由 React 管理。返回取消函数。 */
export function scrambleDigits(el: HTMLElement | null, delay: number, dur: number): () => void {
  if (!el || motionLevel() !== 'full') return () => {};
  const t0 = performance.now() + delay, end = t0 + dur, rnd = () => Math.floor(Math.random() * 10);
  let last = 0, id = 0;
  const step = (now: number) => {
    if (now >= end) { delete el.dataset.scramble; return; }
    if (now >= t0 && now - last > 45) { last = now; el.dataset.scramble = `${rnd()}${rnd()}:${rnd()}${rnd()}`; }
    id = requestAnimationFrame(step);
  };
  id = requestAnimationFrame(step);
  // 窗口在后台或被隐藏时 requestAnimationFrame 会停，乱码会一直盖在读数上（隔离真窗口 2026-11-06 看到读数 24:30）：到点用定时器兜底清掉
  const guard = setTimeout(() => { cancelAnimationFrame(id); delete el.dataset.scramble; }, delay + dur + 100);
  return () => { cancelAnimationFrame(id); clearTimeout(guard); delete el.dataset.scramble; };
}
