import { useEffect, useState } from 'react';
import { PageFrame } from '../../ui/layout/PageFrame';
import { TextInput } from '../../ui/controls/TextInput';
import { Switch } from '../../ui/controls/Switch';
import { Button } from '../../ui/controls/Button';
import type { ProjectOption } from '../../ui/controls/ProjectPicker';
import { activityDayStart } from '../../shared/time';
import { dayLabel, listDays, overlapping } from './listGroups';
import type { ListEntry } from './listGroups';
import { EntryGroupRows } from './EntryRow';
import type { ListActions, RowContext } from './EntryRow';
import './list.css';

const MIN = 60_000, EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const pad = (n: number) => String(n).padStart(2, '0');
const hm = (ms: number) => { const m = Math.round(ms / MIN); return `${Math.floor(m / 60)}:${pad(m % 60)}`; };

/** 每秒刷新一次「现在」：正在计时那条的时长要走。 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  return now;
}

/**
 * 列表页（设计文档「计时 · 列表」，参照 Toggl Track 的 List view）：和日历看的是同一份条目，按时间倒序。
 * 默认最近 7 天、不显示待机；顶部按描述、项目、#标签筛选；底部「再往前 7 天」。
 */
export function ListPage({ entries, projects, knownTags, boundaryHour, isIdle, actions }:
  { entries: readonly ListEntry[]; projects: ProjectOption[]; knownTags: string[]; boundaryHour: number; isIdle: (e: ListEntry) => boolean; actions: ListActions }) {
  const now = useNow();
  const [days, setDays] = useState(7), [showIdle, setShowIdle] = useState(false), [query, setQuery] = useState(''), [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const list = listDays(entries, { now, boundaryHour, days, showIdle, query, isIdle });
  const ctx: RowContext = { now, projects, knownTags, isIdle, overlaps: overlapping(entries, now, isIdle), actions };
  const today = activityDayStart(now, boundaryHour);
  const count = list.reduce((n, d) => n + d.groups.reduce((m, g) => m + g.entries.filter(e => !isIdle(e)).length, 0), 0);
  const toggle = (key: string) => setOpen(prev => { const next = new Set(prev); if (!next.delete(key)) next.add(key); return next; });
  const tools = <>
    <TextInput className="lv-q" type="search" aria-label="筛选" placeholder="筛选：描述、项目、#标签" value={query} onChange={e => setQuery(e.target.value)} />
    <span className="pg-switch"><Switch checked={showIdle} onChange={setShowIdle} label="显示待机" /><span>显示待机</span></span>
  </>;
  return <PageFrame no={pad(count)} en={`LIST · ${days} DAYS`} cn="列表" tools={tools}
    desc="点文字直接改；时间填 9:30，时长填 1h 30m；▶ 继续；同一天相同的记录合成一组，点左边的数字展开。">
    {!list.length && <p className="ls-empty">最近 {days} 天没有{query.trim() ? '符合筛选的' : ''}记录。</p>}
    {list.map(d => {
      const x = new Date(d.day);
      return <section key={d.day} className="lv-day">
        <h3 className="lv-dayhead"><b>{dayLabel(d.day, today)}</b><span>{EN[x.getDay()]} · {x.getMonth() + 1}/{x.getDate()}</span><i /><em>合计 <strong>{hm(d.total)}</strong></em></h3>
        {d.groups.map(g => { const key = `${d.day}|${g.key}`; return <EntryGroupRows key={key} g={g} ctx={ctx} expanded={open.has(key)} onToggle={() => toggle(key)} />; })}
      </section>;
    })}
    <Button className="lv-more" onClick={() => setDays(days + 7)}>再往前 7 天</Button>
  </PageFrame>;
}
