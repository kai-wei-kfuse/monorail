import type { ReactNode, Ref } from 'react';
import type { TopoMode } from '../../ui/effects/Topo';
import { Topo } from '../../ui/effects/Topo';
import { TagStrip } from '../../ui/marks/TagStrip';
import './home.css';

export interface CardLook { topoMode: TopoMode; topoDepth: number; paused: boolean }

/** 首页各种卡共用的外框：等高线背景 + 左侧标签条 + 内容网格 + 演出层插槽。 */
export function CardFrame({ look, running = false, slotNo, slotOf, slotLabel, children, fx, cardRef, innerRef }:
  { look: CardLook; running?: boolean; slotNo: string; slotOf?: string; slotLabel?: string; children: ReactNode; fx?: ReactNode;
    cardRef?: Ref<HTMLElement>; innerRef?: Ref<HTMLDivElement> }) {
  return <section className="card" ref={cardRef} data-fx="card">
    <Topo mode={look.topoMode} depth={look.topoDepth} running={running} paused={look.paused} />
    <TagStrip label={slotLabel} no={slotNo} of={slotOf} />
    <div className="card-in" ref={innerRef}>{children}</div>
    {fx}
  </section>;
}
