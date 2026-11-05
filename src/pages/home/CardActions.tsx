import { ActionButton } from '../../ui/controls/Button';

/**
 * 首页卡片的按钮。待开始：开始 / 缩小；进行中：完成 / 缩小。0.3.1 去掉〔再抽一张〕，抽卡只在今日任务板上（已定 41）。
 * 离开中按钮保持不变。点击时刻 at 由回调在点下的那一刻取，交给 service（架构 §5.1）。
 */
export function CardActions({ running, shrink, busy, compact, onStart, onComplete, onShrink }:
  { running: boolean; shrink: 'ok' | 'max' | 'locked'; busy?: boolean; compact?: boolean;
    onStart: (at: string) => void; onComplete: (at: string) => void; onShrink: (at: string) => void }) {
  const now = () => new Date().toISOString();
  const shrinkTip = shrink === 'max' ? '已经缩到最小一级' : shrink === 'locked' ? '这张卡标了「不可缩小」' : '自我感觉无法完成，可主动降低标准';
  return <>
    {running
      ? <ActionButton primary compact={compact} cn="完成" en="COMPLETE" icon="check" disabled={busy} onClick={() => onComplete(now())} />
      : <ActionButton primary compact={compact} cn="开始" en="START" icon="play" disabled={busy} onClick={() => onStart(now())} />}
    <ActionButton compact={compact} cn="缩小" en="SHRINK" icon="lower" title={shrinkTip} disabled={busy || shrink !== 'ok'} onClick={() => onShrink(now())} />
  </>;
}
