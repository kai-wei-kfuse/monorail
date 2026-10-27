import { Chip } from '../../ui/controls/Chip';
import { TextInput } from '../../ui/controls/TextInput';
import './notices.css';

/** 选一个活动：常用活动点一下就选上，也可以直接写。提示组件内部共用。 */
export function ActivityPick({ label, value, options, onChange, autoFocus }:
  { label: string; value: string; options: string[]; onChange: (v: string) => void; autoFocus?: boolean }) {
  return <div className="nt-field">
    <span>{label}</span>
    {options.length > 0 && <div className="nt-row">{options.map(o => <Chip key={o} label={o} on={o === value} onClick={() => onChange(o)} />)}</div>}
    <TextInput aria-label={label} autoFocus={autoFocus} value={value} placeholder="写一个活动名" onChange={e => onChange(e.target.value)} />
  </div>;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 时刻显示成「10-26 23:40」，同一天只显示时分。 */
export function shortTime(iso: string, ref?: string): string {
  const d = new Date(iso), r = ref ? new Date(ref) : null;
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return r && r.toDateString() === d.toDateString() ? hm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}
