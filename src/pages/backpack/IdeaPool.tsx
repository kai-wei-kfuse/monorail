import { useMemo, useState } from 'react';
import { Button } from '../../ui/controls/Button';
import { Chip } from '../../ui/controls/Chip';
import { TextInput } from '../../ui/controls/TextInput';
import type { IdeaView } from './types';
import './backpack.css';

const days = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

/**
 * 想法池分页。首期只有文字筛选和资源筛选（没有独立搜索页）。
 * 池子允许暂时超过上限，下次回顾时用擂台压回；这里只提示，不拦截。
 * 转过的想法按钮变灰，不再参加上限和擂台。删除只在我明确要求时发生，所以要二次确认（由调用方弹）。
 */
export function IdeaPool({ ideas, limit, onConvert, onDelete }:
  { ideas: IdeaView[]; limit: number; onConvert: (idea: IdeaView) => void; onDelete: (idea: IdeaView) => void }) {
  const [q, setQ] = useState(''), [need, setNeed] = useState<string | null>(null);
  const needs = useMemo(() => [...new Set(ideas.map(i => i.needs).filter((n): n is string => !!n))], [ideas]);
  const active = ideas.filter(i => i.pool === '活跃池').length;
  const shown = ideas.filter(i => (!need || i.needs === need) && (!q || (i.text + ' ' + i.tags.join(' ') + ' ' + (i.needs ?? '')).toLowerCase().includes(q.toLowerCase())));
  return <>
    <div className="bp-tools">
      <TextInput aria-label="筛选想法" placeholder="筛选：文字、#标签" value={q} onChange={e => setQ(e.target.value)} />
      <span className={`bp-cnt${active > limit ? ' over' : ''}`}><b>{active}</b>/ {limit}</span>
    </div>
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
          <Button size="sm" tone="danger" onClick={() => onDelete(i)}>删除</Button>
        </div>
      </li>)}</ul>}
  </>;
}
