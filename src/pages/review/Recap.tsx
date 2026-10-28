import { Group } from '../../ui/layout/GroupTitle';
import { MarkedText } from '../../ui/marks/MarkedText';
import './review.css';

export interface RecapData {
  completed: { id: string; content: string; task: string; day: string; minutes: number }[];
  totals: { project: string; minutes: number }[];      // 按大类的计时汇总，按时长从多到少
  notes: { id: string; content: string; note: string }[]; // 本周留下的「做到哪了」
}

const hm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;

/** 回看：自动列出本周完成的卡、计时汇总和「做到哪了」。只看，不做决定。 */
export function Recap({ data }: { data: RecapData }) {
  const total = data.totals.reduce((n, t) => n + t.minutes, 0), max = Math.max(1, ...data.totals.map(t => t.minutes));
  return <>
    <div className="rv-stats">
      <div className="rv-stat"><b>{data.completed.length}</b><span>完成的卡</span></div>
      <div className="rv-stat"><b>{hm(total)}</b><span>计时合计</span></div>
      <div className="rv-stat"><b>{data.notes.length}</b><span>条做到哪了</span></div>
    </div>
    <Group cn="计时汇总" en="TIME">
      {data.totals.length === 0 ? <p className="ls-empty">这周还没有计时记录。</p>
        : <div className="rv-bars">{data.totals.map(t => <div className="rv-bar" key={t.project}>
          <span>{t.project}</span><i style={{ width: `${(t.minutes / max) * 100}%` }} /><em>{hm(t.minutes)}</em>
        </div>)}</div>}
    </Group>
    <Group cn="完成的卡" en="DONE">
      {data.completed.length === 0 ? <p className="ls-empty">这周还没有完成的卡。</p>
        : <ul className="ls">{data.completed.map(c => <li key={c.id} className="ls-item">
          <div><b><MarkedText content={c.content} /></b><div className="ls-meta"><span>{c.task}</span><span>{c.day}</span><span>{hm(c.minutes)}</span></div></div>
        </li>)}</ul>}
    </Group>
    {data.notes.length > 0 && <Group cn="做到哪了" en="PROGRESS">
      <ul className="ls">{data.notes.map(n => <li key={n.id} className="ls-item">
        <div><b><MarkedText content={n.content} /></b><div className="ls-meta"><span>{n.note}</span></div></div>
      </li>)}</ul>
    </Group>}
  </>;
}
