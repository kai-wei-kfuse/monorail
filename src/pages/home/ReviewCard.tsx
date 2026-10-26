import { ActionButton } from '../../ui/controls/Button';
import type { CardLook } from './CardFrame';
import { CardFrame } from './CardFrame';

/** 回顾卡（选卡优先级 2）：到期后一直出，直到这一期回顾完成。中途关掉的，从记下的那一步接着做。 */
export function ReviewCard({ period, resumeStep, betDue, look, onOpen }:
  { period: string; resumeStep: string | null; betDue: boolean; look: CardLook; onOpen: () => void }) {
  return <CardFrame look={look} slotNo="回" slotLabel="REVIEW">
    <div />
    <div className="alt-hero" data-fx="title">
      <span className="k" data-fx="decode">{`WEEKLY REVIEW ${period}`}</span>
      <h1>每周回顾</h1>
      <p>先看这周做了什么，再整理想法池。{betDue ? '这一期还要做主线复盘：继续还是换。' : ''}
        {resumeStep ? `上次做到「${resumeStep}」，接着做。` : ''}</p>
    </div>
    <div />
    <div className="foot"><div className="actions" data-fx="actions">
      <ActionButton primary cn={resumeStep ? '接着回顾' : '开始回顾'} en="REVIEW" icon="play" onClick={onOpen} />
    </div></div>
  </CardFrame>;
}
