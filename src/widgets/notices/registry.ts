import type { ComponentType } from 'react';
import type { ToastBody } from './toast';
import type { NoticeKind, NoticeProps } from './types';
import { OfflineAsk } from './OfflineAsk';
import { Backfill } from './Backfill';
import { TimeboxShort } from './TimeboxShort';
import { RestReturn } from './RestReturn';
import { LongActivity } from './LongActivity';
import { SkipSignal } from './SkipSignal';
import { Subconscious } from './Subconscious';
import { InputHint } from './InputHint';

/** 需要回答的渲染成对话框，一次只显示一个；轻提示渲染成通知，可以叠几条。 */
export type NoticeEntry<K extends NoticeKind> =
  | { mode: 'dialog'; Component: ComponentType<NoticeProps<K>> }
  | { mode: 'toast'; toast: (props: NoticeProps<K>) => ToastBody };

/** kind → 组件。以后加新提示：在 types.ts 里加一种 kind，再在这里登记一项。 */
export const NOTICES: { [K in NoticeKind]: NoticeEntry<K> } = {
  offlineAsk: { mode: 'dialog', Component: OfflineAsk },
  backfill: { mode: 'dialog', Component: Backfill },
  timeboxShort: { mode: 'dialog', Component: TimeboxShort },
  restReturn: { mode: 'dialog', Component: RestReturn },
  longActivity: { mode: 'toast', toast: LongActivity },
  skipSignal: { mode: 'toast', toast: SkipSignal },
  subconscious: { mode: 'toast', toast: Subconscious },
  inputHint: { mode: 'toast', toast: InputHint },
};
