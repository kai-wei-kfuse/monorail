import type { CSSProperties } from 'react';
import './controls.css';

export interface SwatchOption { value: string; name: string }

/** 强调色色块：34×34，选中的用 2px 黑框加内圈黑色细环。 */
export function Swatch({ options, value, onChange, label }: { options: SwatchOption[]; value: string; onChange: (value: string) => void; label?: string }) {
  const current = options.find(o => o.value === value);
  return <div className="sw-row" role="radiogroup" aria-label={label}>
    {options.map(o => <button key={o.value} type="button" role="radio" aria-checked={o.value === value} aria-label={o.name} title={o.name}
      onClick={() => onChange(o.value)}><i style={{ '--c': o.value } as CSSProperties} /></button>)}
    <span className="sw-name">{current?.name}</span>
  </div>;
}
