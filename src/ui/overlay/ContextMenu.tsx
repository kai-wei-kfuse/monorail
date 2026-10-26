import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './overlay.css';

export type MenuItem = { label: string; onSelect: () => void; keys?: string; checked?: boolean; disabled?: boolean } | 'divider';

/** 软件自己的右键菜单：浅色，菜单项 32px，悬停强调色底，右侧显示快捷键。贴着窗口边缘时自动往里收。 */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(x, innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, innerHeight - r.height - 4)) });
    ref.current!.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);
  useEffect(() => {
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('blur', onClose);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); window.removeEventListener('blur', onClose); };
  }, [onClose]);
  function onKey(e: ReactKeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
  }
  return <div className="ctx" ref={ref} role="menu" style={pos} onKeyDown={onKey} onContextMenu={e => e.preventDefault()}>
    {items.map((it, i) => it === 'divider' ? <hr key={i} /> :
      <button key={i} type="button" role="menuitem" disabled={it.disabled} onClick={() => { onClose(); it.onSelect(); }}>
        <span className="ck">{it.checked ? '✓' : ''}</span>{it.label}{it.keys && <kbd>{it.keys}</kbd>}
      </button>)}
  </div>;
}
