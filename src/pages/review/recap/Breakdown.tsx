import type { CSSProperties } from 'react';
import { Group } from '../../../ui/layout/GroupTitle';
import { MarkedText, plainText } from '../../../ui/marks/MarkedText';
import type { RecapBucket, RecapGroup, RecapResult, RecapRow, RecapViewState } from '../../../shared/recap';
import { RECAP_SYSTEM_COLORS } from '../../../shared/recapColors';
import { clock, collapse, hm, LIMITS, md, msDelta, pct, previousRange, UNIT, wk } from './format';
import { BucketChip } from './Trend';
import { Chev } from './icons';

/** 明细下面的说明：对比区间、上一期有本期没有的组、标签平分、不含待机与睡眠、并行只算一次。 */
export function footnotes(r: RecapResult, view: RecapViewState, today: string, showCmp: boolean): string[] {
  const p = r.previous, out: string[] = [];
  if (showCmp) {
    const gone = r.goneKeys;
    out.push(`增减对比${p.label}（${previousRange(p, today)}）。${gone.length ? `${p.label}有、这期没有的：${gone.slice(0, 5).join('、')}${gone.length > 5 ? ` 等 ${gone.length} 项` : ''}。` : ''}`);
  } else if (!p.comparable) out.push(`${p.label}（${previousRange(p, today)}）早于最早的记录，不显示增减。`);
  if (view.dim === 'tag') out.push('一条记录有多个标签时，时长平均分给各个标签，所以各标签加起来仍等于总时长；条数徽标按出现次数计。');
  if (!view.includeIdle) out.push('不含待机与睡眠，打开右上「含待机/睡眠」可计入。');
  out.push('同一时间并行的记录只算一次，并行的时段按条数平分给各组。');
  return out;
}

function Marks({ row, dim, projectColors }: { row: RecapRow; dim: RecapViewState['dim']; projectColors: Record<string, string> }) {
  const src = dim !== 'source' && (row.source === '临时离开' || row.source === '自由活动') ? row.source : null;
  return <div className="m">
    {row.card && <span className={`rv-cardtag${row.card.track === '主线' ? '' : ' side'}`}>{row.card.track} · {plainText(row.card.content)}</span>}
    {src && <span className={`rv-src${src === '临时离开' ? ' away' : ''}`}>{src}</span>}
    {dim !== 'project' && <span className="proj" style={{ '--pc': projectColors[row.project] ?? RECAP_SYSTEM_COLORS[row.project] ?? '#888884' } as CSSProperties}>{row.project}</span>}
    {dim !== 'tag' && row.tags.map(t => <span key={t} className="tag">#{t}</span>)}
  </div>;
}

function SubList({ g, dim, projectColors }: { g: RecapGroup; dim: RecapViewState['dim']; projectColors: Record<string, string> }) {
  const { shown, hidden } = collapse(g.rows, LIMITS.sub, false);
  return <ul className="rv-sub" style={{ '--sub-c': g.color } as CSSProperties}>
    {shown.map(row => <li key={row.key}>
      <div className="t"><b><MarkedText content={row.description || '（无描述）'} /></b><Marks row={row} dim={dim} projectColors={projectColors} /></div>
      <span className="when">{row.start
        ? <><b>{md(row.firstDay)} {wk(row.firstDay)}</b> {clock(row.start)}–{row.end ? clock(row.end) : '现在'}</>
        : <><b>{row.count} 次</b> · {row.firstDay !== row.lastDay ? `${md(row.firstDay)}–${md(row.lastDay)}` : `${md(row.firstDay)} ${wk(row.firstDay)}`}</>}</span>
      <span className="d">{hm(row.ms)}</span>
    </li>)}
    {hidden > 0 && <li className="more">还有 {hidden} 条</li>}
  </ul>;
}

/**
 * 分组明细：一级行（色块、名称、条数、占比条、百分比、较上一期、时长），点开是二级行。
 * 增减列只在查询给了上一期（整个周期、上一期可比）时出现；筛选某一桶时查询不给，列也就隐藏。
 */
export function Breakdown({ r, view, bucket, today, open, onToggle, onAll, onBucket, projectColors, hot = null }: {
  r: RecapResult; view: RecapViewState; bucket: RecapBucket | null; today: string; hot?: string | null;
  open: ReadonlySet<string>; onToggle: (key: string) => void; onAll: (open: boolean) => void;
  onBucket: (id: string | null) => void; projectColors: Record<string, string>;
}) {
  const groups = r.groups, total = groups.reduce((n, g) => n + g.ms, 0), max = Math.max(1, ...groups.map(g => g.ms));
  const showCmp = groups.some(g => g.previousMs !== undefined);
  const allOpen = groups.length > 0 && groups.every(g => open.has(g.key));
  const notes = footnotes(r, view, today, showCmp);
  const right = <>{bucket && <BucketChip bucket={bucket} onClear={() => onBucket(null)} />}<span>{groups.length} 组 · {hm(total)}</span>
    {groups.length > 0 && <button type="button" className="rv-link" onClick={() => onAll(!allOpen)}>{allOpen ? '全部收起' : '全部展开'}</button>}</>;
  return <Group cn="分组明细" en="BREAKDOWN LIST" right={right}>
    {!groups.length ? <div className="rv-empty-s">{bucket ? UNIT[r.unit].scope : '这个周期'}没有计时记录。</div>
      : <ul className={`rv-bd${showCmp ? ' cmp' : ''}`}>{groups.map(g => {
        const o = open.has(g.key);
        return <li key={g.key}>
          <button type="button" className={`rv-row${hot === g.key ? ' hot' : ''}`} aria-expanded={o} data-k={g.key} onClick={() => onToggle(g.key)}>
            <span className="chev"><Chev /></span><i className="sq" style={{ background: g.color }} />
            <span className="nm"><b>{g.key}</b><small>{g.count}</small></span>
            <span className="bar"><i style={{ width: `${(g.ms / max * 100).toFixed(2)}%`, background: g.color }} /></span>
            <span className="pct">{pct(g.permille)}%</span>
            {showCmp && (g.previousMs === null ? <span className="chg new">新出现</span>
              : g.previousMs === undefined ? <span className="chg" /> : <Change now={g.ms} before={g.previousMs} />)}
            <span className="dur">{hm(g.ms)}</span>
          </button>
          {o && <SubList g={g} dim={view.dim} projectColors={projectColors} />}
        </li>;
      })}</ul>}
    {notes.length > 0 && <p className="rv-foot-note">{notes.map((n, i) => <span key={i}>{i > 0 && <br />}{n}</span>)}</p>}
  </Group>;
}

function Change({ now, before }: { now: number; before: number }) {
  const d = msDelta(now, before);
  return <span className="chg"><b className={d.dir === 'dn' ? 'dn' : undefined}>{d.text}</b></span>;
}
