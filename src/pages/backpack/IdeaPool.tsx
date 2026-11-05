import { useMemo, useState } from 'react';
import { Button } from '../../ui/controls/Button';
import { Chip } from '../../ui/controls/Chip';
import { TextInput } from '../../ui/controls/TextInput';
import { Icon } from '../../ui/icons/Icon';
import type { DoneIdeaView, IdeaView } from './types';
import './backpack.css';

const days = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
const pad = (n: number) => String(n).padStart(2, '0');
/** 完成于：今天 10:12 / 昨天 21:30 / 11-03 15:00（按本机日历日）。 */
export function doneWhen(iso: string, now = new Date()): string {
  const d = new Date(iso), hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  return diff === 0 ? `今天 ${hm}` : diff === 1 ? `昨天 ${hm}` : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}
/** 谁标的完成（沿用操作历史的来源叫法）：手动 / MCP · 调用方 / CLI · 调用方。 */
export function doneBy(by: DoneIdeaView['completedBy']): string {
  if (by.kind === 'manual') return '手动';
  return `${by.kind === 'mcp' ? 'MCP' : by.kind === 'cli' ? 'CLI' : '自动化'} · ${by.agent ?? '未识别'}`;
}

export type IdeaPoolView = 'pool' | 'done';

/**
 * 想法池分页。首期只有文字筛选和资源筛选（没有独立搜索页）。
 * 池子允许暂时超过上限，下次回顾时用擂台压回；这里只提示，不拦截。
 * 转过的想法按钮变灰，不再参加上限和擂台。删除只在我明确要求时发生，所以要二次确认（由调用方弹）。
 * 0.3.0-beta.4 D2（ADR 0020）：上方分段〔想法池 | 已完成〕；做到了的点〔完成〕收进「已完成」，那里可以撤销。
 */
export function IdeaPool({ ideas, done, limit, onConvert, onDelete, onComplete, onUncomplete }:
  { ideas: IdeaView[]; done: DoneIdeaView[]; limit: number; onConvert: (idea: IdeaView) => void; onDelete: (idea: { id: string; text: string }) => void;
    onComplete: (idea: IdeaView) => void; onUncomplete: (idea: DoneIdeaView) => void }) {
  const [view, setView] = useState<IdeaPoolView>('pool');
  const [q, setQ] = useState(''), [need, setNeed] = useState<string | null>(null);
  const needs = useMemo(() => [...new Set(ideas.map(i => i.needs).filter((n): n is string => !!n))], [ideas]);
  const active = ideas.filter(i => i.pool === '活跃池').length;
  const hit = (i: { text: string; tags: string[]; needs: string | null }) => !q || (i.text + ' ' + i.tags.join(' ') + ' ' + (i.needs ?? '')).toLowerCase().includes(q.toLowerCase());
  const shown = ideas.filter(i => (!need || i.needs === need) && hit(i));
  const shownDone = done.filter(hit);
  const seg = <div className="seg id-seg" role="radiogroup" aria-label="想法池视图">
    {([['pool', '想法池', 'IDEAS', ideas.length], ['done', '已完成', 'DONE', done.length]] as const).map(([v, cn, en, n]) =>
      <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}>{cn}<i>{en}</i><b>{n}</b></button>)}
  </div>;
  return <>
    <div className="bp-tools">
      {seg}
      <TextInput aria-label="筛选想法" placeholder="筛选：文字、#标签" value={q} onChange={e => setQ(e.target.value)} />
      {view === 'pool' ? <span className={`bp-cnt${active > limit ? ' over' : ''}`}><b>{active}</b>/ {limit}</span>
        : <span className="bp-cnt"><b>{done.length}</b>个已完成</span>}
    </div>
    {view === 'pool' && <>
      {needs.length > 0 && <div className="bp-tools">{needs.map(n => <Chip key={n} label={`需要：${n}`} on={need === n} onClick={() => setNeed(need === n ? null : n)} />)}</div>}
      {active > limit && <p className="ls-warn">想法池超出上限 {active - limit} 个。下次回顾时会用擂台两两对决，压回到 {limit} 个以内。</p>}
      {shown.length === 0 ? <p className="ls-empty">{ideas.length ? '没有符合筛选的想法。' : '还没有想法。在快速记录条里写一行，不选类型就是想法。'}</p>
        : <ul className="ls">{shown.map(i => <li key={i.id} className={`ls-item${i.pool === '已转任务' ? ' done' : ''}`}>
          <div>
            <b>{i.text}</b>
            <div className="ls-meta">
              {i.tags.map(t => <span key={t}>#{t}</span>)}
              {i.needs && <span>需要：{i.needs}</span>}
              <span>{i.pool === '已转任务' ? '已转任务' : `${days(i.lastTouchedAt)} 天没动`}</span>
            </div>
          </div>
          <div className="ls-acts">
            <Button size="sm" tone="ink" disabled={i.pool === '已转任务'} onClick={() => onConvert(i)}>{i.pool === '已转任务' ? '已转' : '转成任务'}</Button>
            {i.pool === '活跃池' && <Button size="sm" className="id-ok" title="这个想法已经做到了，不用再转成任务" onClick={() => onComplete(i)}><Icon name="check" />完成</Button>}
            <Button size="sm" tone="danger" onClick={() => onDelete(i)}>删除</Button>
          </div>
        </li>)}</ul>}
    </>}
    {view === 'done' && <>
      {shownDone.length === 0 ? <p className="ls-empty">{done.length ? '没有符合筛选的已完成想法。' : '还没有完成的想法。想法池里做到了的，点〔完成〕就收到这里。'}</p>
        : <ul className="ls">{shownDone.map(i => <li key={i.id} className="ls-item id-done">
          <div>
            <b><span className="id-tick" aria-hidden="true"><Icon name="check" /></span>{i.text}</b>
            <div className="ls-meta">
              {i.tags.map(t => <span key={t}>#{t}</span>)}
              <span className="id-when">完成于 {doneWhen(i.completedAt)}</span>
              <span className={`id-by${i.completedBy.kind === 'manual' ? '' : ' auto'}`}>{doneBy(i.completedBy)}</span>
            </div>
          </div>
          <div className="ls-acts">
            <Button size="sm" title="放回想法池" onClick={() => onUncomplete(i)}>撤销完成</Button>
            <Button size="sm" tone="danger" onClick={() => onDelete(i)}>删除</Button>
          </div>
        </li>)}</ul>}
      {done.length > 0 && <p className="id-note">按完成时间从新到旧。撤销完成会放回想法池（算一次「动过」，重新从 0 天计）；池子满了也能放回，下次回顾时用擂台压回上限。</p>}
    </>}
  </>;
}
