// Web Animations 的薄封装（UI风格规范 §8.1）。缓动只在 tokens.css 里定义，这里按名字读出来。

/** full = 完整；reduced = 简化（只留 200–320ms 的淡入淡出）；off = 关闭。系统「减少动态效果」等于 off。 */
export type MotionLevel = 'full' | 'reduced' | 'off';

let chosen: MotionLevel = 'full';

export function setMotionLevel(level: MotionLevel) {
  chosen = level;
  document.documentElement.dataset.motion = level;
}

export function motionLevel(): MotionLevel {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : chosen;
}

const cache = new Map<string, string>();
/** 读 tokens.css 里的缓动：ease / snap / fling。 */
export function easing(name: 'ease' | 'snap' | 'fling'): string {
  let v = cache.get(name);
  if (!v) {
    v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() || 'ease';
    cache.set(name, v);
  }
  return v;
}

type Options = KeyframeAnimationOptions & { ease?: 'ease' | 'snap' | 'fling' };

/** 只在「完整」等级下播放；其他等级返回 null，调用方直接显示最终状态。默认 fill: backwards，演完不留痕。 */
export function play(el: Element | null | undefined, keyframes: Keyframe[], { ease = 'ease', ...options }: Options): Animation | null {
  if (!el || motionLevel() !== 'full') return null;
  return el.animate(keyframes, { easing: easing(ease), fill: 'backwards', ...options });
}

/** 简化等级下用的淡入；关闭时什么都不做。 */
export function fadeIn(el: Element | null | undefined, duration = 260): Animation | null {
  if (!el || motionLevel() === 'off') return null;
  return el.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: easing('ease'), fill: 'backwards' });
}

/** 等一组动画全部结束（被 cancel 也算结束）。 */
export const settled = (list: (Animation | null)[]) =>
  Promise.all(list.map(a => a?.finished.catch(() => undefined))).then(() => undefined);
