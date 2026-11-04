import { useState } from 'react';
import type { RecapBucket, RecapResult } from '../../../shared/recap';
import { hm, hoursLabel, ratio, tickLabel, UNIT, yTicks } from './format';
import { Cross } from './icons';

/** 「已筛选 11.03 周一 ×」：柱状图和明细标题右端共用，点一下取消筛选。 */
export function BucketChip({ bucket, onClear }: { bucket: RecapBucket; onClear: () => void }) {
  return <button type="button" className="rv-chip" title="取消筛选" onClick={onClear}>已筛选 {bucket.title} <Cross /></button>;
}

interface Tip { id: string; x: number; y: number }

/**
 * 堆叠柱状图：≤ 16 天按日、17–100 天按周、> 100 天按月（桶由查询给出）。每根柱子按图表系列（前 8 名 + 其他）堆叠，
 * 柱顶写合计；悬停显示分项，点一下只看这一桶（再点取消）。
 */
export function Trend({ r, bucket, onBucket, hot = null }: { r: RecapResult; bucket: RecapBucket | null; onBucket: (id: string | null) => void; hot?: string | null }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const unit = UNIT[r.unit], { top, ticks } = yTicks(Math.max(0, ...r.buckets.map(b => b.totalMs)));
  const colors = new Map(r.series.map(s => [s.key, s.color]));
  // 超过 10 根柱子时柱顶写整数小时
  const short = r.buckets.length > 10;
  const segs = (b: RecapBucket) => r.series.map(s => ({ key: s.key, color: s.color, ms: b.byKey[s.key] ?? 0 })).filter(s => s.ms > 0);
  const tipBucket = tip ? r.buckets.find(b => b.id === tip.id) ?? null : null;
  return <div className="rv-card">
    <div className="rv-card-h"><span className="k">{unit.en}</span><b>{unit.cn}</b>
      <em>{bucket ? <BucketChip bucket={bucket} onClear={() => onBucket(null)} /> : '悬停看明细 · 点一下柱子筛选下方列表'}</em></div>
    <div className="rv-trend">
      <div className="rv-yaxis">{ticks.map(v => <span key={v} style={{ bottom: `${v / top * 100}%` }}>{tickLabel(v)}</span>)}</div>
      <div className="rv-plot">
        {ticks.slice(1).map(v => <i key={v} className="rv-grid" style={{ bottom: `${v / top * 100}%` }} />)}
        <div className={`rv-cols${bucket ? ' has-sel' : ''}`} onMouseLeave={() => setTip(null)}>
          {r.buckets.map(b => <button key={b.id} type="button" className="rv-col" aria-pressed={bucket?.id === b.id} aria-label={`${b.title} ${hm(b.totalMs)}`}
            onClick={() => { setTip(null); onBucket(bucket?.id === b.id ? null : b.id); }}
            onMouseMove={e => setTip({ id: b.id, x: e.clientX, y: e.clientY })}>
            <span className={`tot${short ? ' short' : ''}`}>{b.totalMs ? short ? hoursLabel(b.totalMs) : hm(b.totalMs) : '—'}</span>
            <span className={`rv-stack${b.totalMs ? '' : ' empty'}`}>{segs(b).map(s => <i key={s.key} data-k={s.key} className={hot === s.key ? 'hot' : undefined}
              style={{ height: `calc(var(--rv-chart-h) * ${(s.ms / top).toFixed(4)})`, background: s.color }} />)}</span>
          </button>)}
        </div>
      </div>
    </div>
    <div className="rv-xaxis">{r.buckets.map(b => <span key={b.id} className={[bucket?.id === b.id && 'on', b.weekend && 'wk'].filter(Boolean).join(' ') || undefined}>
      {b.label}<small>{b.sub}</small></span>)}</div>
    {tip && tipBucket && <BucketTip b={tipBucket} x={tip.x} y={tip.y} colors={colors} selected={bucket?.id === tipBucket.id} action={unit.action} />}
  </div>;
}

function BucketTip({ b, x, y, colors, selected, action }: { b: RecapBucket; x: number; y: number; colors: Map<string, string>; selected: boolean; action: string }) {
  const rows = Object.entries(b.byKey).filter(([, ms]) => ms > 0).sort((a, c) => c[1] - a[1]);
  // 提示框宽最多 280、高按行数估算，靠近窗口边缘时往里收
  const h = 70 + rows.length * 18, w = 280;
  const left = Math.min(x + 16, window.innerWidth - w - 8), top = Math.max(8, Math.min(y + 16, window.innerHeight - h - 8));
  return <div className="rv-tip" style={{ left, top }}>
    <div className="rv-tip-h"><b>{b.title}</b><em>{hm(b.totalMs)}</em></div>
    {rows.length ? <ul>{rows.map(([k, ms]) => <li key={k}><i style={{ background: colors.get(k) }} /><span>{k}</span><em>{hm(ms)}</em><small>{ratio(ms, b.totalMs)}%</small></li>)}</ul>
      : <p>这一段没有记录</p>}
    <p>{selected ? '再点一下取消筛选' : `点一下${action}`}</p>
  </div>;
}
