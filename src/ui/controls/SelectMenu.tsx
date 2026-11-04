import type { KeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../icons/Icon';
import './rangeControls.css';

export interface SelectMenuOption<T extends string> { value: T; cn: string; en?: string }

/**
 * 带英文小字的下拉（UI 风格规范 §11.12「下拉」）：任务卡同款右端黑色箭头块，展开变强调色、箭头朝上。
 * 和 Dropdown 的区别：每项是中文 + 英文小字，弹层左对齐、--paper 底。点外部、Esc 关闭。
 */
export function SelectMenu<T extends string>({ options, value, onChange, label }:
  { options: SelectMenuOption<T>[]; value: T; onChange: (value: T) => void; label?: string }) {
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null), id = useId();
  const current = options.find(o => o.value === value) ?? options[0];
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  function toggle(next = !open) { setActive(Math.max(0, options.findIndex(o => o.value === value))); setOpen(next); }
  function pick(i: number) { setOpen(false); onChange(options[i].value); }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { toggle(true); return; }
      setActive(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if ((e.key === 'Enter' || e.key === ' ') && open) { e.preventDefault(); pick(active); }
  }
  return <div className="msel" ref={box} onKeyDown={onKey}>
    <button type="button" className="msel-btn" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} aria-label={label} onClick={() => toggle()}>
      <span className="msel-lbl"><b>{current?.cn}</b>{current?.en && <i>{current.en}</i>}</span>
      <i className="chev"><Icon name="chev" /></i>
    </button>
    {open && <ul className="msel-pop" role="listbox" id={id}>
      {options.map((o, i) => <li key={o.value} role="option" aria-selected={o.value === value} className={i === active ? 'act' : undefined}
        onPointerEnter={() => setActive(i)} onClick={() => pick(i)}><span>{o.cn}</span>{o.en && <i>{o.en}</i>}</li>)}
    </ul>}
  </div>;
}
