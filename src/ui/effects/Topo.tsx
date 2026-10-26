import { useEffect, useRef } from 'react';
import { motionLevel } from './animate';
import { contours, field, TOPO } from './topoField';
import './effects.css';

export type TopoMode = 'dynamic' | 'static' | 'off';

/**
 * 动态等高线背景：铺满父元素。dynamic 时慢慢流动，running 时流得快一点，最多 25 帧；
 * static 只在尺寸变化或重新显示时画一次；off 不画。paused 或窗口不可见时暂停计算。
 * depth 是用户设的深浅（0–100，默认 60）；cell 首页 12、小窗 8；alpha 小窗 .85。
 */
export function Topo({ mode = 'dynamic', depth = 60, running = false, paused = false, cell = 12, alpha = 1 }:
  { mode?: TopoMode; depth?: number; running?: boolean; paused?: boolean; cell?: number; alpha?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ running, paused, t: 3.7 });
  live.current.running = running;
  live.current.paused = paused;

  useEffect(() => {
    const el = canvas.current!, ctx = el.getContext('2d')!;
    let w = 0, h = 0, dpr = 1, nx = 0, ny = 0, F = new Float32Array(0), raf = 0, last = 0, drawn = 0;
    const f = alpha * depth / 100;
    const draw = () => {
      if (!w || !h) return;
      const { thin, bold } = contours(field(nx, ny, cell, live.current.t, F), nx, ny, cell);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const stroke = (pts: number[], width: number, a: number) => {
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 4) { ctx.moveTo(pts[i], pts[i + 1]); ctx.lineTo(pts[i + 2], pts[i + 3]); }
        ctx.lineWidth = width; ctx.strokeStyle = `rgb(22 22 22 / ${(a * f).toFixed(3)})`; ctx.stroke();
      };
      stroke(thin, 1, .13);
      stroke(bold, 1.4, .24);
    };
    const resize = () => {
      w = el.clientWidth; h = el.clientHeight; dpr = devicePixelRatio || 1;
      el.width = Math.max(1, Math.round(w * dpr)); el.height = Math.max(1, Math.round(h * dpr));
      nx = Math.ceil(w / cell) + 1; ny = Math.ceil(h / cell) + 1; F = new Float32Array(nx * ny);
      if (mode === 'off') ctx.clearRect(0, 0, el.width, el.height); else draw();
    };
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      const dt = last ? Math.min(.1, (ts - last) / 1000) : 0;
      last = ts;
      if (live.current.paused || document.hidden || motionLevel() === 'off') return;
      live.current.t += dt * (live.current.running ? TOPO.runSpeed : TOPO.idleSpeed);
      if (ts - drawn < 1000 / TOPO.fps) return;
      drawn = ts;
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const onShow = () => { if (!document.hidden && mode === 'static') draw(); };
    document.addEventListener('visibilitychange', onShow);
    if (mode === 'dynamic') raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onShow); };
  }, [mode, depth, cell, alpha]);

  return <canvas className="topo" ref={canvas} data-fx="topo" aria-hidden="true" />;
}
