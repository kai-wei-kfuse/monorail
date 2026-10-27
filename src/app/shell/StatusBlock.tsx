import { useEffect, useState } from 'react';
import type { LedKind } from '../../ui/marks/StatusLed';
import { StatusTag } from '../../ui/marks/StatusLed';
import { formatClock } from '../../widgets/cardProgress';
import { Backfill } from '../../widgets/notices/Backfill';
import type { ActivityOption, BackfillResult } from '../../widgets/notices/types';

/**
 * 标题栏状态块：当前活动名 + 已持续多久 + 状态灯（待机强调色、专注 mint 闪烁、离开 cyan）。
 * 时长 = 现在 − 当前段开始时间，每秒刷新显示，不累加成数据（架构 §5.1）。
 * 点它打开补记；补记是用户自己发起的，在这里本地渲染，不走 noticeSlice（架构 §5.6）。
 */
export function StatusBlock({ kind, label, startedAt, activities, onBackfill }:
  { kind: LedKind; label: string; startedAt: string; activities: ActivityOption[]; onBackfill: (result: BackfillResult) => void }) {
  const [now, setNow] = useState(() => Date.now()), [open, setOpen] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <>
    <StatusTag kind={kind} label={label} time={formatClock(now - Date.parse(startedAt))} title="补记：其实从 X 分钟前开始在做 Y" onClick={() => setOpen(true)} />
    {open && <Backfill data={{ activities, now: new Date(now).toISOString() }} dismiss={() => setOpen(false)}
      resolve={result => { setOpen(false); onBackfill(result); }} />}
  </>;
}
