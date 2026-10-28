import type { KeyboardEvent } from 'react';
import { useId, useRef, useState } from 'react';
import { Icon } from '../icons/Icon';
import { enterChoice, matching, moveActive, popupPlacement } from './picker';
import './controls.css';
import './picker.css';

export interface ProjectOption { name: string; color: string }

/**
 * 项目选择：左边是项目色点，点开列出已有项目，输入就筛选。回车选中上下键选到的、或者同名的那一项；
 * 都没有时，给了 onCreate 就新建（先交给 onCreate 登记，再选中它；颜色和保存由调用方决定）。
 * 没处理的按键交给 onKeyDown，方便外面把输入框、项目、标签当成一组。flat 是卡头「记到」那一行的样子（UI 规范 §11.5）。
 */
export function ProjectPicker({ value, options, onChange, onCreate, label = '项目', small, flat, disabled, id, onKeyDown }:
  { value: string; options: ProjectOption[]; onChange: (name: string) => void; onCreate?: (name: string) => void; label?: string;
    small?: boolean; flat?: boolean; disabled?: boolean; id?: string; onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void }) {
  const [q, setQ] = useState<string | null>(null), [active, setActive] = useState(-1), [place, setPlace] = useState('');
  const box = useRef<HTMLDivElement>(null), listId = useId();
  const open = q !== null && !disabled, name = (q ?? '').trim();
  const all = options.map(o => o.name), shown = matching(all, name);
  const color = (n: string) => options.find(o => o.name === n)?.color ?? 'var(--mute-2)';
  const begin = () => {
    const r = box.current?.getBoundingClientRect();
    if (r) setPlace(popupPlacement(r, { width: window.innerWidth, height: window.innerHeight }));
    setQ('');
  };
  const close = () => { setQ(null); setActive(-1); };
  const pick = (n: string) => { onChange(n); close(); };
  const create = (n: string) => { onCreate?.(n); pick(n); };
  function key(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (q === null) begin(); else setActive(i => moveActive(i, shown.length, e.key === 'ArrowDown'));
      return;
    }
    if (e.key === 'Enter') {
      const r = enterChoice(shown, all, name, active, !!onCreate);
      if (r) { e.preventDefault(); if ('pick' in r) pick(r.pick); else create(r.create); return; }
    }
    if (e.key === 'Escape' && q !== null) { e.preventDefault(); close(); return; }
    onKeyDown?.(e);
  }
  return <div ref={box} className={`combo${disabled ? ' off' : ''}${small ? ' sm' : ''}${flat ? ' flat' : ''}`}>
    <i className="combo-dot" style={{ background: color(value) }} />
    <input id={id} disabled={disabled} autoComplete="off" spellCheck={false} role="combobox" aria-label={label} aria-expanded={open} aria-controls={listId}
      value={q ?? value} placeholder={value || label} title={flat && !disabled ? `点一下切换${label}` : label}
      onFocus={begin} onClick={() => { if (q === null) begin(); }} onBlur={close}
      onChange={e => { setQ(e.target.value); setActive(-1); }} onKeyDown={key} />
    <span className="chev" aria-hidden="true"><Icon name="chev" /></span>
    {open && <ul className={`sel-pop combo-pop${place}`} role="listbox" id={listId}>
      {shown.map((n, i) => <li key={n} role="option" aria-selected={n === value} className={i === active ? 'act' : undefined}
        onMouseDown={e => { e.preventDefault(); pick(n); }}><i className="combo-dot" style={{ background: color(n) }} />{n}</li>)}
      {onCreate && name && !all.includes(name) && <li className="new" onMouseDown={e => { e.preventDefault(); create(name); }}>＋ 新建{label}「{name}」</li>}
      {!shown.length && !(onCreate && name) && <li className="none">没有匹配的{label}</li>}
    </ul>}
  </div>;
}
