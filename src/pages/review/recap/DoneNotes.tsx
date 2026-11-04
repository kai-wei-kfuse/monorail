import type { ReactNode } from 'react';
import { Group } from '../../../ui/layout/GroupTitle';
import { MarkedText } from '../../../ui/marks/MarkedText';
import { Tri2 } from '../../../ui/icons/Icon';
import type { RecapDoneCard, RecapNote, RecapView } from '../../../shared/recap';
import { collapse, hm, LIMITS, md, wk } from './format';
import { GridIcon, ListIcon } from './icons';

export type MoreKind = 'done' | 'notes';
interface Props {
  done: readonly RecapDoneCard[]; notes: readonly RecapNote[];
  /** 「本周」或「11.03 周一」：标题右端的范围 */
  scope: string;
  mode: RecapView; onMode: (mode: RecapView) => void;
  more: Record<MoreKind, boolean>; onMore: (kind: MoreKind) => void;
}

const when = (day: string) => `${md(day)} ${wk(day)}`;

/** 完成的卡：背包卡牌（.qc）的只读紧凑版，样式搬成 rv-qc，不引用背包页。 */
function DoneCard({ c }: { c: RecapDoneCard }) {
  const main = c.track === '主线';
  return <article className={`rv-qc rv-dc ${main ? 'main' : 'side'}`}>
    <div className="rv-qc-strip" aria-hidden="true"><span className="vt-t">{main ? 'MAIN' : 'SIDE'}</span><b>{main ? '主' : '支'}</b><Tri2 /><i className="vt-hatch" /></div>
    <div className="rv-qc-body">
      <div className="rv-qc-top"><span className="k">{main ? 'MAIN QUEST' : 'SIDE QUEST'}</span><span className="rv-dc-when">{when(c.day)}</span></div>
      <h4 className="rv-qc-title"><MarkedText content={c.content} /></h4>
      <div className="rv-qc-meta"><span>{c.task}</span></div>
      <div className="rv-qc-proj"><span className="rv-dc-done">DONE ✓</span><span className="rv-dc-dur"><span className="k">TIME<em>用时</em></span><b>{hm(c.ms)}</b></span></div>
    </div>
  </article>;
}
function NoteCard({ n }: { n: RecapNote }) {
  const main = n.track === '主线';
  return <article className={`rv-qc rv-dc rv-nc ${main ? 'main' : 'side'}`}>
    <div className="rv-qc-strip" aria-hidden="true"><span className="vt-t">NOTE</span><b>{main ? '主' : '支'}</b><Tri2 /><i className="vt-hatch" /></div>
    <div className="rv-qc-body">
      <div className="rv-qc-top"><span className="k">PROGRESS<em>做到哪了</em></span><span className="rv-dc-when">{when(n.day)}</span></div>
      <p className="rv-nc-note">{n.note}</p>
      <div className="rv-qc-proj"><span className="rv-qc-meta"><span>{n.track} · {n.task}</span></span></div>
    </div>
  </article>;
}
const Slot = ({ track }: { track: '主线' | '支线' }) => <span className={`rv-slot${track === '主线' ? '' : ' side'}`}>{track}</span>;
const DoneRow = ({ c }: { c: RecapDoneCard }) => <li className="ls-item"><div><b><MarkedText content={c.content} /></b>
  <div className="ls-meta"><Slot track={c.track} /><span>{c.task}</span><span>{when(c.day)}</span></div></div><span className="rv-ls-dur">{hm(c.ms)}</span></li>;
const NoteRow = ({ n }: { n: RecapNote }) => <li className="ls-item"><div><b>{n.note}</b>
  <div className="ls-meta"><Slot track={n.track} /><span>{n.task}</span><span>{when(n.day)}</span></div></div></li>;

/** 超过 6 张卡 / 10 行时先显示最近的，底部虚线按钮展开全部 / 收起。列表已按时间从新到旧排好。 */
function Section<T>({ list, mode, expanded, unit, onMore, card, row }: {
  list: readonly T[]; mode: RecapView; expanded: boolean; unit: string; onMore: () => void;
  card: (x: T) => ReactNode; row: (x: T) => ReactNode;
}) {
  const limit = mode === 'card' ? LIMITS.card : LIMITS.list, { shown, overflow } = collapse(list, limit, expanded);
  return <>
    {mode === 'card' ? <div className="rv-qc-grid rv-done">{shown.map(card)}</div> : <ul className="ls">{shown.map(row)}</ul>}
    {overflow && <button type="button" className="rv-more" onClick={onMore}>{expanded
      ? <>收起，只看最近 {limit} {unit}<i>SHOW LESS</i></>
      : <>还有 {list.length - limit} {unit} · 展开全部 {list.length} {unit}<i>SHOW ALL</i></>}</button>}
  </>;
}

function ModeToggle({ mode, onMode }: { mode: RecapView; onMode: (mode: RecapView) => void }) {
  return <span className="seg rv-view" role="radiogroup" aria-label="显示方式">
    {([['list', '列表', <ListIcon key="l" />], ['card', '卡片', <GridIcon key="g" />]] as const).map(([v, cn, icon]) =>
      <button key={v} type="button" role="radio" aria-checked={mode === v} title={`${cn}模式`} onClick={() => { if (mode !== v) onMode(v); }}>{icon}{cn}</button>)}
  </span>;
}

/** 完成的卡、做到哪了：两区共用一个〔列表 | 卡片〕状态，默认卡片。 */
export function DoneNotes({ done, notes, scope, mode, onMode, more, onMore }: Props) {
  const toggle = <ModeToggle mode={mode} onMode={onMode} />;
  return <>
    <Group cn="完成的卡" en="DONE" right={<><span>{scope} · {done.length} 张</span>{toggle}</>}>
      {done.length ? <Section list={done} mode={mode} expanded={more.done} unit="张" onMore={() => onMore('done')}
        card={c => <DoneCard key={c.id} c={c} />} row={c => <DoneRow key={c.id} c={c} />} />
        : <p className="ls-empty">{scope}没有完成的卡。</p>}
    </Group>
    <Group cn="做到哪了" en="PROGRESS" right={<><span>{scope} · {notes.length} 条</span>{toggle}</>}>
      {notes.length ? <Section list={notes} mode={mode} expanded={more.notes} unit="条" onMore={() => onMore('notes')}
        card={n => <NoteCard key={n.id} n={n} />} row={n => <NoteRow key={n.id} n={n} />} />
        : <p className="ls-empty">{scope}没有留下「做到哪了」。</p>}
    </Group>
  </>;
}
