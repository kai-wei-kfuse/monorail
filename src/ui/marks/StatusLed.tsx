import './marks.css';

/** idle = 待机（强调色），focus = 专注（mint，闪烁），away = 离开 / 快捷活动（cyan）。 */
export type LedKind = 'idle' | 'focus' | 'away';

export function StatusLed({ kind }: { kind: LedKind }) {
  return <i className="st-led" data-kind={kind} aria-hidden="true" />;
}

/** 标题栏状态块：28px 黑块，状态灯 + 活动名 + 计时。给了 onClick 就是按钮（例如打开补记）。 */
export function StatusTag({ kind, label, time, onClick, title }: { kind: LedKind; label: string; time: string; onClick?: () => void; title?: string }) {
  const body = <><StatusLed kind={kind} /><span className="st-label">{label}</span><span className="st-time">{time}</span></>;
  return onClick
    ? <button type="button" className="status" data-in title={title} onClick={onClick}>{body}</button>
    : <span className="status" data-in title={title}>{body}</span>;
}
