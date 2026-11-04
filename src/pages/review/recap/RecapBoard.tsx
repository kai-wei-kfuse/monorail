import { useState } from 'react';
import type { MouseEvent } from 'react';
import { RECAP_PERIODS } from '../../../shared/recap';
import type { RecapResult, RecapViewState } from '../../../shared/recap';
import { Controls } from './Controls';
import { Stats } from './Stats';
import { Trend } from './Trend';
import { Composition } from './Composition';
import { Breakdown } from './Breakdown';
import { DoneNotes } from './DoneNotes';
import type { MoreKind } from './DoneNotes';
import { inBucket } from './format';
import './recap.css';

export interface RecapBoardProps {
  /** 当前选择下的查询结果；还没查出来时为 null */
  result: RecapResult | null;
  view: RecapViewState; onView: (next: RecapViewState) => void;
  /** 只看某一根柱子（桶 id）；查询已按它重算了明细 */
  bucket: string | null; onBucket: (id: string | null) => void;
  /** 今天所在的活动日、最早记录所在的活动日（自定义日期的可选范围） */
  today: string; minDay: string | null;
  projectColors: Record<string, string>;
  /** 一次性提示（例如记住的选择读不出来） */
  notice?: string | null;
}

/**
 * 回看看板（UI 风格规范 §11.12）：控制栏、4 张概览卡、柱状图 + 环形图、分组明细、完成的卡 / 做到哪了。
 * 选择和查询由外面管；这里只管界面状态：展开了哪些组（换分组时收起）、卡片区是否展开全部
 * （换模式、周期或柱子筛选时收回）、悬停的分项（其余变淡）。
 */
export function RecapBoard({ result: r, view, onView, bucket, onBucket, today, minDay, projectColors, notice }: RecapBoardProps) {
  const [open, setOpen] = useState<{ dim: string; keys: ReadonlySet<string> }>({ dim: view.dim, keys: new Set() });
  const moreKey = [view.view, view.period, view.from, view.to, bucket].join('|');
  const [more, setMore] = useState<{ key: string; done: boolean; notes: boolean }>({ key: moreKey, done: false, notes: false });
  const [hot, setHot] = useState<string | null>(null);
  const keys = open.dim === view.dim ? open.keys : new Set<string>();
  const expanded = more.key === moreKey ? more : { done: false, notes: false };
  // 换了周期（含自定义起止）时柱子换了一批，筛选跟着取消
  const changeView = (next: RecapViewState) => {
    if (next.period !== view.period || next.from !== view.from || next.to !== view.to) onBucket(null);
    onView(next);
  };
  const onHover = (e: MouseEvent) => {
    const k = (e.target as Element).closest?.('[data-k]')?.getAttribute('data-k') ?? null;
    if (k !== hot) setHot(k);
  };
  if (!r) return <div className="rv-board"><p className="ls-empty">正在统计…</p></div>;
  const sel = bucket ? r.buckets.find(b => b.id === bucket) ?? null : null;
  const scope = sel ? sel.title : RECAP_PERIODS.find(p => p.id === view.period)?.cn ?? '';
  const toggle = (key: string) => { const next = new Set(keys); if (next.has(key)) next.delete(key); else next.add(key); setOpen({ dim: view.dim, keys: next }); };
  return <div className="rv-board" onMouseOver={onHover} onMouseLeave={() => setHot(null)}>
    {notice && <p className="ls-warn rv-notice">{notice}</p>}
    <Controls view={view} range={r.range} today={today} minDay={minDay} onView={changeView} />
    <Stats r={r} today={today} />
    <div className={`rv-charts${hot !== null ? ' rv-hot' : ''}`}>
      <Trend r={r} bucket={sel} onBucket={onBucket} hot={hot} />
      <Composition r={r} dim={view.dim} hot={hot} />
    </div>
    <div className={hot !== null ? 'rv-hot' : undefined}>
      <Breakdown r={r} view={view} bucket={sel} today={today} open={keys} onToggle={toggle} projectColors={projectColors} onBucket={onBucket} hot={hot}
        onAll={all => setOpen({ dim: view.dim, keys: all ? new Set(r.groups.map(g => g.key)) : new Set() })} />
    </div>
    <DoneNotes done={inBucket(r.done, sel)} notes={inBucket(r.notes, sel)} scope={scope} mode={view.view} onMode={mode => onView({ ...view, view: mode })}
      more={expanded} onMore={(kind: MoreKind) => setMore({ ...expanded, key: moreKey, [kind]: !expanded[kind] })} />
  </div>;
}
