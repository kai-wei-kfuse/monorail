import { fromLocalValue, toLocalValue } from './localTime';
import './controls.css';

/** 日期时间输入，精确到分钟。值是 ISO 字符串，空值为 null。 */
export function DateTimeInput({ value, onChange, label }: { value: string | null; onChange: (iso: string | null) => void; label?: string }) {
  return <input type="datetime-local" className="inp dt" aria-label={label} value={toLocalValue(value)} onChange={e => onChange(fromLocalValue(e.target.value))} />;
}
