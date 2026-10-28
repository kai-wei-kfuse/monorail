import { Button } from './Button';
import { TextInput } from './TextInput';
import { Icon } from '../icons/Icon';
import './controls.css';

/** 可增减的事项列表（UI 规范 §11.10）：每行编号、输入框、去掉按钮；最多 max 项。 */
export function ItemsEditor({ id, items, onChange, max, hint }: { id: string; items: string[]; onChange: (items: string[]) => void; max: number; hint: string }) {
  return <div className="ie">
    {items.map((s, k) => <div key={k} className="ie-row"><span className="ie-no">{String(k + 1).padStart(2, '0')}</span>
      <TextInput id={`${id}-${k}`} aria-label={`第 ${k + 1} 项`} value={s} placeholder="一件能判断做没做完的事" onChange={e => onChange(items.map((x, j) => j === k ? e.target.value : x))} />
      <button type="button" className="ie-rm" aria-label="去掉这一项" title="去掉这一项" onClick={() => onChange(items.filter((_, j) => j !== k))}><Icon name="x" /></button></div>)}
    <div className="ie-foot"><Button size="sm" disabled={items.length >= max} onClick={() => onChange([...items, ''])}>＋ 拆一项</Button><span>{hint}</span></div>
  </div>;
}
