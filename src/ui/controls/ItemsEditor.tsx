import { Button } from './Button';
import { TextInput } from './TextInput';
import { Segmented } from './Segmented';
import { Icon } from '../icons/Icon';
import './controls.css';

/** 一项的类型（0.3.1 已定 46、64）：结果卡做完算完成；时间盒计满分钟数算完成。 */
export interface EditorItem { text: string; type: '结果' | '时间盒'; minutes: number }

/**
 * 可增减的事项列表（UI 规范 §11.10、§11.15）：每行编号、输入框、去掉按钮；最多 max 项。
 * 给了 typed（新建任务）时每行多一组〔结果 | 时间盒〕，时间盒后面一个分钟数；新加一行默认结果卡，分钟数用 defaultMinutes（设置 01「时间盒默认时长」）。
 */
export function ItemsEditor({ id, items, onChange, max, hint }: { id: string; items: string[]; onChange: (items: string[]) => void; max: number; hint: string }) {
  return <div className="ie">
    {items.map((s, k) => <div key={k} className="ie-row"><span className="ie-no">{String(k + 1).padStart(2, '0')}</span>
      <TextInput id={`${id}-${k}`} aria-label={`第 ${k + 1} 项`} value={s} placeholder="一件能判断做没做完的事" onChange={e => onChange(items.map((x, j) => j === k ? e.target.value : x))} />
      <button type="button" className="ie-rm" aria-label="去掉这一项" title="去掉这一项" onClick={() => onChange(items.filter((_, j) => j !== k))}><Icon name="x" /></button></div>)}
    <div className="ie-foot"><Button size="sm" disabled={items.length >= max} onClick={() => onChange([...items, ''])}>＋ 拆一项</Button><span>{hint}</span></div>
  </div>;
}

export function TypedItemsEditor({ id, items, onChange, max, hint, defaultMinutes }:
  { id: string; items: EditorItem[]; onChange: (items: EditorItem[]) => void; max: number; hint: string; defaultMinutes: number }) {
  const set = (k: number, patch: Partial<EditorItem>) => onChange(items.map((x, j) => j === k ? { ...x, ...patch } : x));
  return <div className="ie">
    {items.map((it, k) => <div key={k} className="ie-row typed"><span className="ie-no">{String(k + 1).padStart(2, '0')}</span>
      <TextInput id={`${id}-${k}`} aria-label={`第 ${k + 1} 项`} value={it.text} placeholder="一件能判断做没做完的事" onChange={e => set(k, { text: e.target.value })} />
      <Segmented label={`第 ${k + 1} 项的类型`} value={it.type} onChange={type => set(k, { type })} options={[{ value: '结果', label: '结果' }, { value: '时间盒', label: '时间盒' }]} />
      <span className="ie-min" hidden={it.type !== '时间盒'}>
        <input type="number" aria-label={`第 ${k + 1} 项的分钟数`} min={5} step={5} value={it.minutes} onChange={e => set(k, { minutes: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />分</span>
      <button type="button" className="ie-rm" aria-label="去掉这一项" title="去掉这一项" onClick={() => onChange(items.filter((_, j) => j !== k))}><Icon name="x" /></button></div>)}
    <div className="ie-foot"><Button size="sm" disabled={items.length >= max} onClick={() => onChange([...items, { text: '', type: '结果', minutes: defaultMinutes }])}>＋ 加一项</Button><span>{hint}</span></div>
  </div>;
}
