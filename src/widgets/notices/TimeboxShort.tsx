import { Dialog } from '../../ui/overlay/Dialog';
import { Button } from '../../ui/controls/Button';
import type { NoticeProps } from './types';

/**
 * 时间盒没计满就点了完成：下限是提示，不是拦截。
 * 「沿方向继续」什么都不结束；「就到这」照样算完成，计时段结束在点〔完成〕的那一刻（附录 A2），所以带回 data.at。
 */
export function TimeboxShort({ data, resolve, dismiss }: NoticeProps<'timeboxShort'>) {
  const keep = () => resolve({ choice: 'continue', at: data.at });
  return <Dialog en="TIMEBOX" title={`还差 ${data.remainingMinutes} 分钟`} onClose={dismiss}
    footer={<><Button onClick={keep}>沿方向继续</Button><Button tone="ink" autoFocus onClick={() => resolve({ choice: 'stop', at: data.at })}>就到这</Button></>}>
    选「就到这」照样算完成，计入每日底线，按实际时长记录。
  </Dialog>;
}
