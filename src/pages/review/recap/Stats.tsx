import type { ReactNode } from 'react';
import { RECAP_SOURCES } from '../../../shared/recap';
import type { RecapResult } from '../../../shared/recap';
import { RECAP_SOURCE_COLORS } from '../../../shared/recapColors';
import { delta, hm, msDelta, pct, pointDelta, previousRange, ratio } from './format';
import type { Delta } from './format';

const PARALLEL = '同一时间并行的记录只算一次';

/** 每张卡底部的「较上一期」：上一期早于最早记录时写「较前一年 —」，不对比。 */
function Compare({ r, today, value }: { r: RecapResult; today: string; value: () => Delta }) {
  const p = r.previous;
  if (!p.comparable) return <span className="rv-delta none" title={`${p.label}（${previousRange(p, today)}）早于最早的记录，不对比`}>较{p.label} <b>—</b></span>;
  const d = value();
  return <span className="rv-delta">较{p.label} <b className={d.dir === 'dn' ? 'dn' : d.dir === 'up' ? 'up' : undefined}>{d.text}</b></span>;
}
function Stat({ k, cn, lead, title, children }: { k: string; cn: string; lead?: boolean; title?: string; children: ReactNode }) {
  return <div className={`rv-stat${lead ? ' lead' : ''}`} title={title}><span className="k">{k}<em>{cn}</em></span>{children}</div>;
}

/** 4 张概览卡：有效投入、主线投入、完成的卡、做到哪了；都是整个周期的数，不随柱状图筛选变。 */
export function Stats({ r, today }: { r: RecapResult; today: string }) {
  const src = r.mainline.bySource, main = r.done.filter(c => c.track === '主线').length;
  return <div className="rv-stats">
    <Stat k="EFFECTIVE" cn="有效投入" lead title={`有效投入：去掉待机与睡眠后的实际占用时间，${PARALLEL}`}>
      <b>{hm(r.effectiveMs)}</b>
      <span>日均 <em>{hm(r.activeDays ? r.effectiveMs / r.activeDays : 0)}</em> · {r.activeDays} 个有效天</span>
      <span className="rv-stat-note">{PARALLEL}</span>
      <Compare r={r} today={today} value={() => msDelta(r.effectiveMs, r.previous.effectiveMs)} />
    </Stat>
    <Stat k="MAINLINE" cn="主线投入">
      <b>{pct(r.mainline.permille)}<small>%</small></b>
      <span className="rv-src-bar">{RECAP_SOURCES.map(s => <i key={s} style={{ flex: `${src[s]} 0 0`, background: RECAP_SOURCE_COLORS[s] }}
        title={`${s} ${hm(src[s])} · ${ratio(src[s], r.effectiveMs)}%`} />)}</span>
      <span title={`自由 ${hm(src['自由活动'])} · 临时离开 ${hm(src['临时离开'])}`}>主线 <em>{hm(src['主线任务'])}</em> · 支线 <em>{hm(src['支线任务'])}</em></span>
      <Compare r={r} today={today} value={() => pointDelta(r.mainline.permille, r.previous.mainPermille)} />
    </Stat>
    <Stat k="DONE" cn="完成的卡">
      <b>{r.done.length}<small>张</small></b>
      <span>主线 <em>{main}</em> · 支线 <em>{r.done.length - main}</em></span>
      <Compare r={r} today={today} value={() => delta(r.done.length - r.previous.done, String, ' 张')} />
    </Stat>
    <Stat k="PROGRESS" cn="做到哪了">
      <b>{r.notes.length}<small>条</small></b>
      <span>共 <em>{r.entryCount}</em> 条计时记录</span>
      <Compare r={r} today={today} value={() => delta(r.notes.length - r.previous.notes, String, ' 条')} />
    </Stat>
  </div>;
}
