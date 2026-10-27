import { Button } from '../../ui/controls/Button';
import type { ToastBody } from './toast';
import type { NoticeProps } from './types';
import { now } from './types';

/** 同一个休息回答累计出现多次：建议把它放进支线格。界面上平时不显示计数，只在这里提一次。 */
export const Subconscious = ({ data, resolve }: NoticeProps<'subconscious'>): ToastBody => ({
  en: 'SUBCONSCIOUS', title: `休息时「${data.answer}」已经出现 ${data.count} 次`, text: '也许它值得正式做，要放进支线格吗？',
  actions: <>
    <Button size="sm" tone="ink" onClick={() => resolve({ accept: true, at: now() })}>放进支线</Button>
    <Button size="sm" onClick={() => resolve({ accept: false, at: now() })}>不用</Button>
  </>,
});
