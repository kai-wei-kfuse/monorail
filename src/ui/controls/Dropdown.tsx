import type { KeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../icons/Icon';
import './controls.css';

export interface DropdownOption<T extends string | number> { value: T; label: string }

/** 下拉：右端黑色箭头块，展开后变强调色；靠近窗口底部时向上弹出。 */
export function Dropdown<T extends string | number>({ options, value, onChange, label }:
  { options: DropdownOption<T>[]; value: T; onChange: (value: T) => void; label?: string }) {
  const [open, setOpen] = useState(false), [up, setUp] = useState(false), [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null), id = useId();
  const current = options.find(o => o.value === value);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  function toggle(next = !open) {
    if (next && box.current) setUp(box.current.getBoundingClientRect().bottom + options.length * 32 + 16 > window.innerHeight);
    setActive(Math.max(0, options.findIndex(o => o.value === value)));
    setOpen(next);
  }
  function pick(i: number) { onChange(options[i].value); setOpen(false); }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { toggle(true); return; }
      setActive(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if ((e.key === 'Enter' || e.key === ' ') && open) { e.preventDefault(); pick(active); }
  }
  return <div className="sel" ref={box} onKeyDown={onKey}>
    <button type="button" className="sel-btn" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} aria-label={label} onClick={() => toggle()}>
      <span>{current?.label ?? ''}</span><i className="chev"><Icon name="chev" /></i>
    </button>
    {open && <ul className={`sel-pop${up ? ' up' : ''}`} role="listbox" id={id}>
      {options.map((o, i) => <li key={String(o.value)} role="option" aria-selected={o.value === value} className={i === active ? 'act' : undefined}
        onPointerEnter={() => setActive(i)} onClick={() => pick(i)}>{o.label}</li>)}
    </ul>}
  </div>;
}
