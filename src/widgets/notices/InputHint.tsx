import type { ToastBody } from './toast';
import type { NoticeProps } from './types';

type Props = NoticeProps<'inputHint'>;

/** 休息后不久又达到拒绝阈值：只提醒一句，不做功能，内容让我自己找。 */
export const InputHint: (props: Props) => ToastBody = () => ({
  en: 'INPUT MODE', title: '换成输入吧', text: '看点存过的东西。',
});
