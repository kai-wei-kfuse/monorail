import type { ComponentType } from 'react';
import { ToastStack } from '../../ui/overlay/Toast';
import type { ToastBody } from '../../widgets/notices/toast';
import { NOTICES } from '../../widgets/notices/registry';
import type { Notice, NoticeKind, NoticeProps, NoticeResult } from '../../widgets/notices/types';

type AnyProps = NoticeProps<NoticeKind>;
type Resolve = (notice: Notice, result: NoticeResult[NoticeKind]) => void;

/**
 * 按提示种类渲染：需要回答的一次只弹一个对话框（队列里最早的那个），轻提示叠成通知。
 * 用户回答时调 onResolve(notice, result)，直接关掉时调 onDismiss(notice)；之后由调用方把它移出队列。
 */
export function NoticeHost({ notices, onResolve, onDismiss }: { notices: Notice[]; onResolve: Resolve; onDismiss: (notice: Notice) => void }) {
  const props = (n: Notice): AnyProps => ({ data: n.data, resolve: result => onResolve(n, result), dismiss: () => onDismiss(n) });
  const dialog = notices.find(n => NOTICES[n.kind].mode === 'dialog');
  const toasts = notices.filter(n => NOTICES[n.kind].mode === 'toast').map(n => {
    const entry = NOTICES[n.kind] as { toast: (p: AnyProps) => ToastBody };
    return { id: n.id, ...entry.toast(props(n)) };
  });
  const Dialog = dialog && (NOTICES[dialog.kind] as { Component: ComponentType<AnyProps> }).Component;
  return <>
    {dialog && Dialog && <Dialog key={dialog.id} {...props(dialog)} />}
    <ToastStack items={toasts} onClose={id => { const n = notices.find(x => x.id === id); if (n) onDismiss(n); }} />
  </>;
}
