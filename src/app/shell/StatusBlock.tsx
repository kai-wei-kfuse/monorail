import { useEffect, useState } from 'react';
import type { LedKind } from '../../ui/marks/StatusLed';
import { StatusTag } from '../../ui/marks/StatusLed';
import { plainText } from '../../ui/marks/MarkedText';
import { formatClock } from '../../widgets/cardProgress';

/**
 * 标题栏状态块：当前活动名 + 已持续多久 + 状态灯（待机强调色、专注 mint 闪烁、离开 cyan）。
 * 时长 = 现在 − 当前段开始时间，每秒刷新显示，不累加成数据（架构 §5.1）。offsetMs：插入的事前面已计完的几段（暂停后继续不归零，用户 2026-11-06）。
 * 点它打开补记；补记对话框由外壳管理（长时间提醒里的「其实换了」也会打开它）。
 */
export function StatusBlock({ kind, label, startedAt, offsetMs, onClick }: { kind: LedKind; label: string; startedAt: string | null; offsetMs?: number; onClick: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  // A paused insert has no running tail; its explicitly supplied cumulative offset stays visible.
  const time = startedAt ? formatClock((offsetMs ?? 0) + now - Date.parse(startedAt)) : offsetMs !== undefined ? formatClock(offsetMs) : '--:--';
  return <StatusTag kind={kind} label={plainText(label)} time={time}
    title="补记：其实从 X 分钟前开始在做 Y" onClick={onClick} />;
}
