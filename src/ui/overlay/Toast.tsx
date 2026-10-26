import type { ReactNode } from 'react';
import { Icon } from '../icons/Icon';
import './overlay.css';

export interface ToastItem { id: string; en: string; title: string; text?: string; actions?: ReactNode }

/** 应用内通知：左侧 5px 强调色竖条，从右侧滑入。一次可以叠几条，新的在下。 */
export function ToastStack({ items, onClose }: { items: ToastItem[]; onClose: (id: string) => void }) {
  return <div className="toasts" role="status" aria-live="polite">
    {items.map(t => <div className="toast" key={t.id}>
      <Icon name="logo" />
      <div><span className="k">{t.en}</span><b>{t.title}</b>{t.text && <p>{t.text}</p>}{t.actions && <div className="t-acts">{t.actions}</div>}</div>
      <button type="button" className="t-x" aria-label="关闭通知" onClick={() => onClose(t.id)}><Icon name="x" /></button>
    </div>)}
  </div>;
}
