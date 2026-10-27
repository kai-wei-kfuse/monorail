import { Button } from '../../ui/controls/Button';
import type { ToastBody } from './toast';
import type { NoticeProps } from './types';
import { now } from './types';

/** 同一张卡被「再抽一张」跳过多次：这件事可能太大、太模糊或其实不想做，建议拆小或 PASS。 */
export const SkipSignal = ({ data, resolve }: NoticeProps<'skipSignal'>): ToastBody => ({
  en: 'SKIP SIGNAL', title: `「${data.title}」已经跳过 ${data.count} 次`, text: '这件事可能太大、太模糊，或者其实不想做。',
  actions: <>
    <Button size="sm" tone="ink" onClick={() => resolve({ choice: 'split', at: now() })}>拆小</Button>
    <Button size="sm" onClick={() => resolve({ choice: 'pass', at: now() })}>PASS</Button>
    <Button size="sm" onClick={() => resolve({ choice: 'ignore', at: now() })}>忽略</Button>
  </>,
});
