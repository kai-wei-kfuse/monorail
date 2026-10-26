import './controls.css';

/** 方形开关，旁边写 ON / OFF。 */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label?: string }) {
  return <button type="button" className="tgl" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}>
    <span className="sw" /><span className="tv">{checked ? 'ON' : 'OFF'}</span>
  </button>;
}
