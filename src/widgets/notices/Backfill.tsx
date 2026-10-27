import { useState } from 'react';
import { Dialog } from '../../ui/overlay/Dialog';
import { Button } from '../../ui/controls/Button';
import { Segmented } from '../../ui/controls/Segmented';
import { Slider } from '../../ui/controls/Slider';
import { DateTimeInput } from '../../ui/controls/DateTimeInput';
import { ActivityPick } from './ActivityPick';
import type { NoticeProps } from './types';
import { now } from './types';
import './notices.css';

/**
 * 补记（设计文档「计时」）。两种方式：
 * - 一键补记「其实从 N 分钟前开始在做 Y」：Y 成为当前活动并一直计下去；有卡进行中时 Y 按插入处理。
 * - 区间补记：补一段有起止的过去时段，不改变当前活动。
 */
export function Backfill({ data, resolve, dismiss }: NoticeProps<'backfill'>) {
  const [mode, setMode] = useState<'since' | 'range'>('since');
  const [minutesAgo, setMinutesAgo] = useState(15), [activity, setActivity] = useState('');
  const [from, setFrom] = useState<string | null>(null), [to, setTo] = useState<string | null>(null);
  const act = activity.trim();
  const rangeError = mode !== 'range' || !from || !to ? ''
    : Date.parse(from) >= Date.parse(to) ? '开始要早于结束'
    : Date.parse(to) > Date.parse(data.now) ? '不能补记还没到的时间' : '';
  const ok = !!act && (mode === 'since' || (!!from && !!to && !rangeError));
  function submit() {
    if (!ok) return;
    const at = now();
    resolve(mode === 'since' ? { mode, minutesAgo, activity: act, at } : { mode, from: from!, to: to!, activity: act, at });
  }
  return <Dialog en="BACKFILL" title="补记" onClose={dismiss}
    footer={<><Button onClick={dismiss}>取消</Button><Button tone="ink" disabled={!ok} onClick={submit}>补记</Button></>}>
    <Segmented label="方式" value={mode} onChange={setMode}
      options={[{ value: 'since', label: '其实早就在做' }, { value: 'range', label: '补一段过去的时间' }]} />
    {mode === 'since'
      ? <div className="nt-field"><span>其实从多久以前开始</span><Slider label="几分钟前" value={minutesAgo} min={5} max={240} step={5} unit="MIN AGO" onChange={setMinutesAgo} /></div>
      : <div className="nt-field"><span>从 … 到 …</span><div className="nt-row">
          <DateTimeInput label="开始" value={from} onChange={setFrom} /><i>→</i><DateTimeInput label="结束" value={to} onChange={setTo} />
        </div></div>}
    <ActivityPick label={mode === 'since' ? '在做什么（之后接着计时）' : '那段时间在做什么'} value={activity} options={data.activities} onChange={setActivity} />
    {rangeError && <p className="nt-err">{rangeError}</p>}
  </Dialog>;
}
