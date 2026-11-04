import { RECAP_DIMENSIONS } from '../../../shared/recap';
import type { RecapResult } from '../../../shared/recap';
import { hm, LIMITS, pct } from './format';

const RING = 22, GAP = 1.2, R = 100 - RING / 2 - 2, L = 2 * Math.PI * R;

/** 环形图的每一段：[可见长度, 偏移]。段与段之间留 1.2 的缝；只有一段时不留。 */
export function arcs(values: readonly number[], total: number): { dash: number; offset: number }[] {
  const gap = values.length > 1 ? GAP : 0;
  let off = 0;
  return values.map(v => { const len = total ? v / total * L : 0, out = { dash: Math.max(0, len - gap), offset: -off }; off += len; return out; });
}

/** 整体构成：环形图（中心是合计和有效天）、前 6 项图例、分段构成条。整个周期，不随柱状图筛选变。 */
export function Composition({ r, dim, hot = null }: { r: RecapResult; dim: string; hot?: string | null }) {
  const on = (key: string) => hot === key ? 'hot' : undefined;
  const ser = r.series, legend = ser.slice(0, LIMITS.legend);
  const count = ser.reduce((n, s) => n + (s.merged || 1), 0), cn = RECAP_DIMENSIONS.find(d => d.id === dim)?.cn ?? '';
  const a = arcs(ser.map(s => s.ms), r.totalMs);
  return <div className="rv-card">
    <div className="rv-card-h"><span className="k">COMPOSITION</span><b>整体构成</b><em>{cn} · {count} 项</em></div>
    <div className="rv-comp">
      <div className="rv-donut">
        <svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r={R} fill="none" stroke="var(--line)" strokeWidth={RING} />
          {ser.map((s, i) => <circle key={s.key} data-k={s.key} className={on(s.key)} cx="100" cy="100" r={R} fill="none" stroke={s.color} strokeWidth={RING}
            strokeDasharray={`${a[i].dash} ${L - a[i].dash}`} strokeDashoffset={a[i].offset} />)}</svg>
        <div className="rv-donut-c"><span className="k">TOTAL</span><b>{hm(r.totalMs)}</b><span>{r.activeDays} 个有效天</span></div>
      </div>
      <ul className="rv-legend">
        {legend.map(s => <li key={s.key} data-k={s.key} className={on(s.key)}><i style={{ background: s.color }} /><span>{s.key}{s.merged ? ` · ${s.merged} 项` : ''}</span>
          <em>{hm(s.ms)}</em><small>{pct(s.permille)}%</small></li>)}
        {ser.length > legend.length && <li className="more">还有 {ser.length - legend.length} 项，见下方明细</li>}
      </ul>
    </div>
    <div className="rv-strip">{ser.map(s => <i key={s.key} data-k={s.key} className={on(s.key)} title={`${s.key} ${hm(s.ms)} · ${pct(s.permille)}%`} style={{ flex: `${s.ms} 0 0`, background: s.color }} />)}</div>
    <div className="rv-strip-scale"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
  </div>;
}
