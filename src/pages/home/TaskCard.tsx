import type { ReactNode, Ref } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { Progress } from '../../widgets/cardProgress';
import { formatMinutes } from '../../widgets/cardProgress';
import { Corners } from '../../ui/marks/Corners';
import { TrackMark } from '../../ui/marks/TrackMark';
import { VBars } from '../../ui/marks/VBars';
import { Readout } from '../../ui/marks/Readout';
import type { CardLook } from './CardFrame';
import { CardFrame } from './CardFrame';
import { fitTitleSize } from './title';
import { MarkedText } from '../../ui/marks/MarkedText';

export interface TaskCardView {
  id?: string;                 // 卡的 id；有它才能双击改内容
  slotNo: string;             // 背包格号，例如「01」；不属于项目的卡是「支」（LOOSE.slot）
  slotOf?: string;             // 「/03」
  task: string;             // 项目名；不属于项目的卡显示「支线」
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

/**
 * 首页的任务卡。按钮、右上角的小字（「还没有主线」「今天不再出卡」）和演出层都由外面传进来。
 * 给了 onEditContent，双击标题就能就地改卡的内容：[词] 标记照原文显示，也能改；回车或点别处保存，Esc 不改。
 * 自由记录卡也用它：meta 换掉类型那几个字，picks 是后面「记到」那一行，digits 换掉读数（可以是 TimeField），
 * note 换掉「上次做到」那一行，stateText 换掉状态字，placeholder 是内容为空时标题位置的提示。
 */
export function TaskCard({ view, look, titleScale, actions, corner, fx, cardRef, innerRef, onEditContent, meta, picks, digits, note, stateText, placeholder }:
  { view: TaskCardView; look: CardLook; titleScale: number; actions: ReactNode; corner?: ReactNode; fx?: ReactNode;
    cardRef?: Ref<HTMLElement>; innerRef?: Ref<HTMLDivElement>; onEditContent?: (cardId: string, content: string) => void;
    meta?: ReactNode; picks?: ReactNode; digits?: ReactNode; note?: ReactNode; stateText?: readonly [string, string]; placeholder?: string }) {
  const hero = useRef<HTMLDivElement>(null), title = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState<string | null>(null), done = useRef(false), editing = useRef<{ id: string; content: string } | null>(null);
  const { progress } = view;
  const [cn, en] = stateText ?? STATE[progress.state];
  const stateCn = progress.state === 'away' && view.awayActivity ? `${cn} · ${view.awayActivity}` : cn;
  const canEdit = !!onEditContent && view.id !== undefined;
  // 双击时就记下改的是哪张卡：编辑期间首页换了卡，保存时仍交出原来那张的 id。
  // 回车保存后输入框被卸掉，还会再收到一次失焦；done 保证只交出一次
  const beginEdit = () => { done.current = false; editing.current = { id: view.id!, content: view.content }; setDraft(view.content); };
  const finish = (keep: boolean) => {
    if (done.current || !editing.current) return;
    done.current = true;
    const text = draft?.trim(), { id, content } = editing.current;
    if (keep && text && text !== content) onEditContent?.(id, text);
    editing.current = null;
    setDraft(null);
  };

  useLayoutEffect(() => {
    // 编辑时标题换成了输入框，不用排字号；换回来以后重新排
    const h = hero.current, t = title.current;
    if (!h || !t) return;
    const box = t.parentElement!;
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
  }, [view.content, titleScale, view.progressNote, draft === null, note]);

  return <CardFrame look={look} running={progress.state === 'run'} slotNo={view.slotNo} slotOf={view.slotOf} cardRef={cardRef} innerRef={innerRef} fx={fx}>
    <div className="c-head" data-fx="head">
      <TrackMark /><b>{view.task}</b>
      <span className="c-meta">{meta ?? <>{view.type === '时间盒卡' ? '时间盒' : '结果卡'}{view.goalMinutes !== null && <em>目标 {view.goalMinutes} 分钟</em>}</>}</span>
      {picks}
      {corner && <span className="c-corner">{corner}</span>}
    </div>
    <div className="hero" ref={hero}>
      <Corners>
        {draft !== null
          ? <input className="title-edit" aria-label="卡的内容" value={draft} autoFocus onChange={e => setDraft(e.target.value)} onBlur={() => finish(true)}
              onKeyDown={e => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') { e.preventDefault(); finish(true); }
                if (e.key === 'Escape') { e.preventDefault(); finish(false); }
              }} />
          : <h1 className="title" ref={title} data-fx="title" title={canEdit ? '双击编辑' : undefined} onDoubleClick={canEdit ? beginEdit : undefined}>
              {view.content ? <MarkedText content={view.content} /> : <span className="ph">{placeholder}</span>}
            </h1>}
      </Corners>
      {note ?? (view.progressNote && <p className="c-note"><b>上次做到</b>{view.progressNote}</p>)}
    </div>
    <VBars filled={progress.filled} state={progress.state} />
    <div className="foot">
      <div className="actions" data-fx="actions">{actions}</div>
      <Readout state={progress.state} stateCn={stateCn} stateEn={en} digits={digits ?? formatMinutes(view.elapsedMs)}
        over={progress.overMs > 0 ? `+${formatMinutes(progress.overMs)}` : null} />
    </div>
  </CardFrame>;
}
