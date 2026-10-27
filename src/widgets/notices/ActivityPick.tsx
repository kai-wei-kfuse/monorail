import { Chip } from '../../ui/controls/Chip';
import { TextInput } from '../../ui/controls/TextInput';
import type { ActivityOption } from './types';
import './notices.css';

/**
 * 选一个活动：常用活动点一下就选上，也可以直接写一个名字。提示组件内部共用。
 * 点选的交出快捷活动的 id，手写的交出名字；timerService 两种都认（不是 id 就按名字落账，类别默认「生活」）。
 */
export function ActivityPick({ label, value, options, onChange, autoFocus }:
  { label: string; value: string; options: ActivityOption[]; onChange: (v: string) => void; autoFocus?: boolean }) {
  const picked = options.find(o => o.id === value);
  return <div className="nt-field">
    <span>{label}</span>
    {options.length > 0 && <div className="nt-row">
      {options.map(o => <Chip key={o.id} label={o.name} on={o.id === value} onClick={() => onChange(o.id)} />)}
    </div>}
    <TextInput aria-label={label} autoFocus={autoFocus} value={picked ? picked.name : value} placeholder="或者直接写一个活动名"
      onChange={e => onChange(e.target.value)} />
  </div>;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 时刻显示成「10-26 23:40」，和参照时刻同一天时只显示时分。 */
export function shortTime(iso: string, ref?: string): string {
  const d = new Date(iso), r = ref ? new Date(ref) : null;
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return r && r.toDateString() === d.toDateString() ? hm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}
