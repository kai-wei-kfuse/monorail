import { useState } from 'react';
import { SelectMenu } from '../../../ui/controls/SelectMenu';
import { DateRangePicker } from '../../../ui/controls/DateRangePicker';
import { Switch } from '../../../ui/controls/Switch';
import { RECAP_DIMENSIONS, RECAP_PERIODS } from '../../../shared/recap';
import type { RecapPeriod, RecapRange, RecapViewState } from '../../../shared/recap';
import { rangeText } from './format';

const PERIODS = RECAP_PERIODS.map(p => ({ value: p.id, cn: p.cn, en: p.en }));
const DIMS = RECAP_DIMENSIONS.map(d => ({ value: d.id, cn: d.cn, en: d.en }));

/**
 * 控制栏：周期下拉 + 区间小字（自定义时换成起止日期按钮）、分组下拉、含待机 / 睡眠开关。
 * 选「自定义时间」时先用当前区间作为自定义起止，并直接弹出日期选择。
 */
export function Controls({ view, range, today, minDay, onView, loose = false }:
  { view: RecapViewState; range: RecapRange; today: string; minDay: string | null; onView: (next: RecapViewState) => void;
    /** 宽松模式：待机不计，开关只剩睡眠 */ loose?: boolean }) {
  const idleLabel = loose ? '含睡眠' : '含待机/睡眠';
  const [picking, setPicking] = useState(false);
  const period = (p: RecapPeriod) => {
    if (p === 'custom') { if (view.period !== 'custom') onView({ ...view, period: p, from: range.fromDay, to: range.toDay }); setPicking(true); return; }
    onView({ ...view, period: p, from: null, to: null });
  };
  return <div className="rv-ctl">
    <div className="rv-ctl-item"><span className="k">PERIOD<em>周期</em></span>
      <SelectMenu label="周期" options={PERIODS} value={view.period} onChange={period} />
      {view.period === 'custom'
        ? <DateRangePicker from={range.fromDay} to={range.toDay} minDay={minDay} today={today} open={picking} onOpenChange={setPicking}
          onApply={(from, to) => onView({ ...view, from, to })} />
        : <span className="rv-range">{rangeText(range, today)}</span>}
    </div>
    <div className="rv-ctl-item"><span className="k">GROUP BY<em>分组</em></span>
      <SelectMenu label="分组" options={DIMS} value={view.dim} onChange={dim => onView({ ...view, dim })} />
    </div>
    <div className="rv-ctl-item rv-ctl-idle"><span className="k">IDLE<em>{idleLabel}</em></span>
      <Switch label={idleLabel} checked={view.includeIdle} onChange={includeIdle => onView({ ...view, includeIdle })} />
    </div>
  </div>;
}
