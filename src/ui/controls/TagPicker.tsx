import type { KeyboardEvent } from 'react';
import { useId, useRef, useState } from 'react';
import { Chip } from './Chip';
import { enterChoice, matching, moveActive, popupPlacement, tagName } from './picker';
import './controls.css';
import './picker.css';

const ADD_KEYS = ['Enter', ',', '，', ' '];

/**
 * 标签选择：已选的标签是标签片；点开列出还没选的已有标签，输入就筛选。回车、空格、逗号把输入的字变成标签，
 * 不在已有标签里的先交给 onCreate 登记；输入框为空时按退格，去掉最后一个。
 * 没处理的按键交给 onKeyDown。flat 是卡头「记到」那一行的样子（UI 规范 §11.5）。
 */
export function TagPicker({ value, options, onChange, onCreate, label = '标签', flat, disabled, id, onKeyDown }:
  { value: string[]; options: string[]; onChange: (tags: string[]) => void; onCreate?: (tag: string) => void; label?: string;
    flat?: boolean; disabled?: boolean; id?: string; onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void }) {
  const [q, setQ] = useState<string | null>(null), [active, setActive] = useState(-1), [place, setPlace] = useState(''), listId = useId();
  const box = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const begin = () => {
    const r = box.current?.getBoundingClientRect();
    if (r) setPlace(popupPlacement(r, { width: window.innerWidth, height: window.innerHeight }));
    setQ('');
  };
  const open = q !== null && !disabled, name = tagName(q ?? '');
  const shown = matching(options.filter(t => !value.includes(t)), name).slice(0, 12);
  const placeholder = flat ? (value.length ? '＋' : `＋ ${label}`) : value.length ? '' : `# ${label}`;
  function add(t: string) {
    setQ(''); setActive(-1);
    if (!t || value.includes(t)) return;
    if (!options.includes(t)) onCreate?.(t);
    onChange([...value, t]);
  }
  function key(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (q === null) begin(); else setActive(i => moveActive(i, shown.length, e.key === 'ArrowDown'));
      return;
    }
    if (ADD_KEYS.includes(e.key)) {
      const r = enterChoice(shown, options, name, active, true);
      if (r) { e.preventDefault(); add('pick' in r ? r.pick : r.create); return; }
    }
    if (e.key === 'Backspace' && !q && value.length) { onChange(value.slice(0, -1)); return; }
    if (e.key === 'Escape' && q !== null) { e.preventDefault(); setQ(null); setActive(-1); return; }
    onKeyDown?.(e);
  }
  return <div ref={box} className={`tagpick${disabled ? ' off' : ''}${flat ? ' flat' : ''}`}
    onMouseDown={e => { if (!disabled && e.target === box.current) { e.preventDefault(); input.current?.focus(); } }}>
    {value.map(t => <Chip key={t} label={`#${t}`} onRemove={disabled ? undefined : () => onChange(value.filter(x => x !== t))} />)}
    <input ref={input} id={id} disabled={disabled} autoComplete="off" spellCheck={false} role="combobox" aria-label={label} aria-expanded={open} aria-controls={listId}
      value={q ?? ''} placeholder={placeholder} title={flat && !disabled ? `点一下加${label}` : undefined}
      onFocus={begin} onClick={() => { if (q === null) begin(); }} onBlur={() => { setQ(null); setActive(-1); }}
      onChange={e => { setQ(e.target.value); setActive(-1); }} onKeyDown={key} />
    {open && <ul className={`sel-pop combo-pop${place}`} role="listbox" id={listId}>
      {shown.map((t, i) => <li key={t} role="option" aria-selected={false} className={i === active ? 'act' : undefined}
        onMouseDown={e => { e.preventDefault(); add(t); }}>#{t}</li>)}
      {name && !options.includes(name) && !value.includes(name) && <li className="new" onMouseDown={e => { e.preventDefault(); add(name); }}>＋ 新建{label}「#{name}」</li>}
      {!shown.length && !name && <li className="none">{options.length ? `已有的${label}都加上了，输入就能新建` : `还没有${label}，输入就能新建`}</li>}
    </ul>}
  </div>;
}
