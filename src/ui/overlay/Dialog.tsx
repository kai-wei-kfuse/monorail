import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import './overlay.css';

/** 模态对话框。Esc 和点遮罩都等于 onClose；打开时焦点进入对话框，Tab 不会跑到外面。 */
export function Dialog({ en, title, children, footer, onClose }: { en: string; title: string; children?: ReactNode; footer?: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null), id = useId();
  useEffect(() => {
    const el = ref.current!, before = document.activeElement as HTMLElement | null;
    // 子元素用了 autoFocus 时已经拿到焦点，不再抢；否则先找输入框，再找按钮
    if (!el.contains(document.activeElement)) (el.querySelector<HTMLElement>('input, textarea') ?? el.querySelector<HTMLElement>('button') ?? el).focus();
    return () => before?.focus?.();
  }, []);
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const f = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, [tabindex="0"]')];
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  return <div className="dlg-mask" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="dlg" ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} onKeyDown={onKey}>
      <div className="dlg-head"><span className="k">{en}</span><h2 id={id}>{title}</h2></div>
      {children && <div className="dlg-body">{children}</div>}
      {footer && <div className="dlg-foot">{footer}</div>}
    </div>
  </div>;
}
