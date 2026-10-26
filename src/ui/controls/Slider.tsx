import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { useRef } from 'react';
import { clampStep } from './clampStep';
import './controls.css';

/** 滑块：轨道是一排竖刻度，已选部分是黑色高刻度。支持方向键、PageUp / PageDown 和 Home / End。 */
export function Slider({ value, min, max, step = 1, unit, onChange, label, ticks = 24 }:
  { value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void; label?: string; ticks?: number }) {
  const track = useRef<HTMLDivElement>(null);
  const f = (value - min) / (max - min || 1);
  const set = (v: number) => { const next = clampStep(v, min, max, step); if (next !== value) onChange(next); };
  function fromPointer(e: PointerEvent) {
    const r = track.current!.getBoundingClientRect();
    set(min + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (max - min));
  }
  function onKey(e: KeyboardEvent) {
    const map: Record<string, number> = {
      ArrowRight: value + step, ArrowUp: value + step, ArrowLeft: value - step, ArrowDown: value - step,
      PageUp: value + step * 10, PageDown: value - step * 10, Home: min, End: max,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    set(map[e.key]);
  }
  return <div className="rng" role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
    aria-valuetext={unit ? `${value} ${unit}` : String(value)} onKeyDown={onKey} style={{ '--f': f, '--n': ticks } as CSSProperties}>
    <div className="rng-track" ref={track}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); fromPointer(e); }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e); }}>
      <i className="rng-fill" /><i className="rng-thumb" />
    </div>
    <span className="rng-val"><b>{value}</b>{unit && <small>{unit}</small>}</span>
  </div>;
}
