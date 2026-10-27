import { useEffect, useState } from 'react';
import type { LedKind } from '../../ui/marks/StatusLed';
import { StatusTag } from '../../ui/marks/StatusLed';
import { plainText } from '../../ui/marks/MarkedText';
import { formatClock } from '../../widgets/cardProgress';

/**
 * 标题栏状态块：当前活动名 + 已持续多久 + 状态灯（待机强调色、专注 mint 闪烁、离开 cyan）。
 * 时长 = 现在 − 当前段开始时间，每秒刷新显示，不累加成数据（架构 §5.1）。
 * 点它打开补记；补记对话框由外壳管理（长时间提醒里的「其实换了」也会打开它）。
 */
export function StatusBlock({ kind, label, startedAt, onClick }: { kind: LedKind; label: string; startedAt: string | null; onClick: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <StatusTag kind={kind} label={plainText(label)} time={startedAt ? formatClock(now - Date.parse(startedAt)) : '--:--'}
    title="补记：其实从 X 分钟前开始在做 Y" onClick={onClick} />;
}
