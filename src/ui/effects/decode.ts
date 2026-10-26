// 英文小字解码（UI风格规范 §5.7）：先乱码，再从左到右逐字定稿，520ms。
import { motionLevel } from './animate';

const POOL = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789/#-';
export const DECODE_MS = 520;

/** 进度 p ∈ [0, 1] 时显示的文字：前 floor(len·p) 个字已定稿，其余随机，空格保持不变。 */
export function decodeFrame(final: string, p: number, rnd: () => number = Math.random): string {
  if (p >= 1) return final;
  const n = Math.max(0, Math.floor(final.length * p));
  return final.slice(0, n) + [...final.slice(n)].map(c => (c === ' ' ? ' ' : POOL[Math.floor(rnd() * POOL.length)])).join('');
}

/** 对元素的第一个文本节点做解码；返回取消函数。非「完整」动效等级下什么都不做。 */
export function decode(el: Element | null | undefined, delay = 0): () => void {
  if (!el || motionLevel() !== 'full') return () => {};
  const node = el.firstChild?.nodeType === Node.TEXT_NODE ? el.firstChild : el;
  const final = (el as HTMLElement).dataset.final ??= node.textContent ?? '';
  let t0 = 0, id = 0;
  const step = (ts: number) => {
    t0 ||= ts;
    const p = (ts - t0 - delay) / DECODE_MS;
    if (p > 0) node.textContent = decodeFrame(final, p);
    if (p < 1) id = requestAnimationFrame(step);
  };
  id = requestAnimationFrame(step);
  return () => { cancelAnimationFrame(id); node.textContent = final; };
}
