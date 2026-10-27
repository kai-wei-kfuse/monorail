import type { ToastItem } from '../../ui/overlay/Toast';

/** 轻提示组件返回的通知内容；id 由 NoticeHost 填。 */
export type ToastBody = Omit<ToastItem, 'id'>;
