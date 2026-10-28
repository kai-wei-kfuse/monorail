import type { ReactNode, Ref } from 'react';
import type { MeterState } from './VBars';
import './marks.css';

/** 计时读数：「ELAPSED 已用」+ 状态行 + 大号数字（可以是就地编辑的 TimeField）。over 有值时，状态行前面多一个黑底黄字的超出时长。 */
export function Readout({ state, stateCn, stateEn, digits, over, digitsRef, en = 'ELAPSED', cn = '已用' }:
  { state: MeterState; stateCn: string; stateEn: string; digits: ReactNode; over?: string | null; digitsRef?: Ref<HTMLSpanElement>; en?: string; cn?: string }) {
  return <div className="readout" data-state={state}>
    <div className="t-state">
      <span className="k" data-fx="decode">{en}<em>{cn}</em></span>
      <div className="t-row">{over && <span className="over">{over}</span>}<span className="dot" /><b>{stateCn}</b><i>{stateEn}</i></div>
    </div>
    <span className="digits" ref={digitsRef} role="timer" aria-live="off">{digits}</span>
  </div>;
}
