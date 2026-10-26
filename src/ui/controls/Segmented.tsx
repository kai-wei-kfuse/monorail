import type { KeyboardEvent } from 'react';
import './controls.css';

export interface SegmentOption<T extends string | number> { value: T; label: string; disabled?: boolean; badge?: string }

/** 分段选择：选中段黑底白字，底部 3px 强调色条；不可用段后面跟小标签（例如「开发中」）。 */
export function Segmented<T extends string | number>({ options, value, onChange, label }:
  { options: SegmentOption<T>[]; value: T; onChange: (value: T) => void; label?: string }) {
  const enabled = options.filter(o => !o.disabled);
  function onKey(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step || !enabled.length) return;
    e.preventDefault();
    const i = enabled.findIndex(o => o.value === value);
    onChange(enabled[(i + step + enabled.length) % enabled.length].value);
  }
  return <div className="seg" role="radiogroup" aria-label={label} onKeyDown={onKey}>
    {options.map(o => <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value}
      tabIndex={o.value === value ? 0 : -1} disabled={o.disabled} onClick={() => onChange(o.value)}>
      {o.label}{o.badge && <small>{o.badge}</small>}
    </button>)}
  </div>;
}
