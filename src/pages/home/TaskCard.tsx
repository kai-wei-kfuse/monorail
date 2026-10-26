import type { ReactNode, Ref } from 'react';
import { useLayoutEffect, useRef } from 'react';
import type { Progress } from '../../widgets/cardProgress';
import { formatMinutes } from '../../widgets/cardProgress';
import { Corners } from '../../ui/marks/Corners';
import { TrackMark } from '../../ui/marks/TrackMark';
import { VBars } from '../../ui/marks/VBars';
import { Readout } from '../../ui/marks/Readout';
import type { CardLook } from './CardFrame';
import { CardFrame } from './CardFrame';
import { fitTitleSize, parseMarks } from './title';

export interface TaskCardView {
  slotNo: string;              // 背包格号，例如「01」；散件是「散」
  slotOf?: string;             // 「/03」
  project: string;             // 项目名；散件显示「散件」
  type: '结果卡' | '时间盒卡';
  goalMinutes: number | null;  // 只有时间盒卡有
  content: string;             // 带 [词] 标记的原文
  progressNote?: string;       // 上次留下的「做到哪了」
  elapsedMs: number;
  progress: Progress;
  awayActivity?: string;       // 离开中正在计的快捷活动
}

const STATE = {
  ready: ['待开始', 'READY'], run: ['进行中', 'RUNNING'], away: ['离开中', 'AWAY'], over: ['已超出目标', 'OVERTIME'],
} as const;

/** 首页的任务卡。按钮、右上角的小字（「还没有主线」「今天不再出卡」）和演出层都由外面传进来。 */
export function TaskCard({ view, look, titleScale, actions, corner, fx, cardRef, innerRef }:
  { view: TaskCardView; look: CardLook; titleScale: number; actions: ReactNode; corner?: ReactNode; fx?: ReactNode;
    cardRef?: Ref<HTMLElement>; innerRef?: Ref<HTMLDivElement> }) {
  const hero = useRef<HTMLDivElement>(null), title = useRef<HTMLHeadingElement>(null);
  const { progress } = view;
  const [cn, en] = STATE[progress.state];
  const stateCn = progress.state === 'away' && view.awayActivity ? `${cn} · ${view.awayActivity}` : cn;

  useLayoutEffect(() => {
    const h = hero.current!, t = title.current!, box = t.parentElement!;
    const fit = () => {
      if (!h.clientWidth) return;
      const bs = getComputedStyle(box);
      // 左边距是负的，角标伸出去；可用宽度要把它加回来
      const availW = h.clientWidth - parseFloat(bs.paddingRight) - parseFloat(bs.paddingLeft) - parseFloat(bs.marginLeft);
      const availH = h.clientHeight - parseFloat(bs.paddingTop) - parseFloat(bs.paddingBottom) - (h.querySelector('.c-note')?.clientHeight ?? 0);
      t.style.maxWidth = availW + 'px';
      const size = fitTitleSize(s => { t.style.setProperty('--ts', s + 'px'); return t.scrollWidth <= availW + 1 && t.scrollHeight <= availH + 1; }, titleScale);
      t.style.setProperty('--ts', size + 'px');
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(h);
    return () => ro.disconnect();
  }, [view.content, titleScale, view.progressNote]);

  return <CardFrame look={look} running={progress.state === 'run'} slotNo={view.slotNo} slotOf={view.slotOf} cardRef={cardRef} innerRef={innerRef} fx={fx}>
    <div className="c-head" data-fx="head">
      <TrackMark /><b>{view.project}</b>
      <span className="c-meta">{view.type === '时间盒卡' ? '时间盒' : '结果卡'}{view.goalMinutes !== null && <em>目标 {view.goalMinutes} 分钟</em>}</span>
      {corner && <span className="c-corner">{corner}</span>}
    </div>
    <div className="hero" ref={hero}>
      <Corners>
        <h1 className="title" ref={title} data-fx="title">
          {parseMarks(view.content).map((p, i) => p.mark ? <span key={i} className="hl">{p.text}</span> : p.text)}
        </h1>
      </Corners>
      {view.progressNote && <p className="c-note"><b>上次做到</b>{view.progressNote}</p>}
    </div>
    <VBars filled={progress.filled} state={progress.state} />
    <div className="foot">
      <div className="actions" data-fx="actions">{actions}</div>
      <Readout state={progress.state} stateCn={stateCn} stateEn={en} digits={formatMinutes(view.elapsedMs)}
        over={progress.overMs > 0 ? `+${formatMinutes(progress.overMs)}` : null} />
    </div>
  </CardFrame>;
}
