import { Button } from '../../ui/controls/Button';
import type { ToastBody } from './toast';
import type { NoticeProps } from './types';
import { now } from './types';

/** 同一活动持续太久：轻提醒确认一下。还在做就关掉；其实早换了就去补记。 */
export const LongActivity = ({ data, resolve }: NoticeProps<'longActivity'>): ToastBody => ({
  en: 'STILL ON IT', title: `「${data.activity}」已经持续 ${data.hours} 小时`, text: '还在做这件事吗？',
  actions: <>
    <Button size="sm" onClick={() => resolve({ still: true, at: now() })}>还在做</Button>
    <Button size="sm" tone="ink" onClick={() => resolve({ still: false, at: now() })}>其实换了，去补记</Button>
  </>,
});
