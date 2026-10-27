import { useState } from 'react';
import { Dialog } from '../../ui/overlay/Dialog';
import { Button } from '../../ui/controls/Button';
import { Segmented } from '../../ui/controls/Segmented';
import { ActivityPick, shortTime } from './ActivityPick';
import type { NoticeProps } from './types';
import { now } from './types';
import './notices.css';

/** 从 X 到 Y 在做什么。系统已经按「离线」记下了，不回答就保持离线；改成睡觉或某个活动才需要确认。 */
export function OfflineAsk({ data, resolve, dismiss }: NoticeProps<'offlineAsk'>) {
  const [mode, setMode] = useState<'离线' | '睡觉' | '活动'>('离线'), [activity, setActivity] = useState('');
  const minutes = Math.round((Date.parse(data.to) - Date.parse(data.from)) / 60_000);
  const value = mode === '活动' ? activity.trim() : mode;
  return <Dialog en="OFFLINE" title="这段时间在做什么" onClose={dismiss}
    footer={<><Button onClick={dismiss}>就算离线</Button><Button tone="ink" disabled={!value} onClick={() => resolve({ activity: value, at: now() })}>确定</Button></>}>
    <div className="nt-span"><b>{shortTime(data.from, data.to)}</b><i>→</i><b>{shortTime(data.to)}</b><i>共 {minutes} 分钟</i></div>
    程序在这段时间没有运行（关机、休眠或崩溃），已经先记成「离线」。
    <div className="nt-field"><Segmented label="记成" value={mode} onChange={setMode}
      options={[{ value: '离线', label: '离线' }, { value: '睡觉', label: '睡觉' }, { value: '活动', label: '某个活动' }]} /></div>
    {mode === '活动' && <ActivityPick label="活动" value={activity} options={data.activities} onChange={setActivity} autoFocus />}
  </Dialog>;
}
