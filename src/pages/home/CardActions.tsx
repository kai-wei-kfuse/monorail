import { ActionButton } from '../../ui/controls/Button';

/**
 * 首页卡片的按钮。待开始：开始 / 缩小；进行中：完成 / 缩小。0.3.1 去掉〔再抽一张〕，抽卡只在今日任务板上（已定 41）；
 * 缩小不设上限（已定 54），不再按级数或「不可缩小」置灰。点击时刻 at 由回调在点下的那一刻取，交给 service（架构 §5.1）。
 */
export function CardActions({ running, busy, compact, onStart, onComplete, onShrink }:
  { running: boolean; busy?: boolean; compact?: boolean;
    onStart: (at: string) => void; onComplete: (at: string) => void; onShrink: (at: string) => void }) {
  const now = () => new Date().toISOString();
  return <>
    {running
      ? <ActionButton primary compact={compact} cn="完成" en="COMPLETE" icon="check" disabled={busy} onClick={() => onComplete(now())} />
      : <ActionButton primary compact={compact} cn="开始" en="START" icon="play" disabled={busy} onClick={() => onStart(now())} />}
    <ActionButton compact={compact} cn="缩小" en="SHRINK" icon="lower" title="今天先做一部分：拆成今天做的和剩下的" disabled={busy} onClick={() => onShrink(now())} />
  </>;
}
