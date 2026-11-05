import { useState } from 'react';
import { Dialog } from '../../ui/overlay/Dialog';
import { Button } from '../../ui/controls/Button';
import { ActivityPick, shortTime } from './ActivityPick';
import type { NoticeProps } from './types';
import { now } from './types';
import './notices.css';

/**
 * 紧凑模式的空闲追问（ADR 0021 第 13 条）：待机或暂停超过设置 04「空闲多久后追问」后开始了下一件事，问那一段在做什么。
 * 不回答就保持待机；填了就把那段改成这项活动。宽松模式不出现。
 */
export function IdleAsk({ data, resolve, dismiss }: NoticeProps<'idleAsk'>) {
  const [activity, setActivity] = useState('');
  const value = activity.trim();
  return <Dialog en="IDLE" title="刚才这段在做什么" onClose={dismiss}
    footer={<><Button onClick={dismiss}>就算待机</Button><Button tone="ink" disabled={!value} onClick={() => resolve({ activity: value, at: now() })}>确定</Button></>}>
    <div className="nt-span"><b>{shortTime(data.from, data.to)}</b><i>→</i><b>{shortTime(data.to)}</b><i>共 {data.minutes} 分钟</i></div>
    这段时间记成了待机。想补上在做什么的话，写一项活动。
    <ActivityPick label="活动" value={activity} options={data.activities} onChange={setActivity} autoFocus />
  </Dialog>;
}
