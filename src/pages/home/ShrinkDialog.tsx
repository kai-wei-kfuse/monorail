import { useState } from 'react';
import { Dialog } from '../../ui/overlay/Dialog';
import { Button } from '../../ui/controls/Button';
import { Slider } from '../../ui/controls/Slider';
import { TextInput } from '../../ui/controls/TextInput';
import { plainText } from '../../ui/marks/MarkedText';
import './home.css';

export type CardType = '结果卡' | '时间盒卡';

/**
 * 缩小 = 今天先做一部分（ADR 0021 第 4 条，已定 50、54；UI 风格规范 §11.15）。
 * 原来这一项拆成「今天做的」（留在原位、接着计）和「剩下的」（放回背包，排在后面）。
 * 时间盒：拖滑块分今天做多少分钟，两份加起来等于原来今天的量；今天这份不能少于今天已计。结果卡只写两句。
 * 不显示第几级，可以一直往下拆。确认时才写盘；取消不写。
 */
export function ShrinkDialog({ original, type, todayGoal, minToday, onConfirm, onCancel }:
  { original: string; type: CardType; todayGoal: number | null;
    /** 今天这份的下限（今天已计向上取到 5，和服务端同一个公式） */
    minToday: number;
    onConfirm: (r: { todayContent: string; restContent: string; restMinutes: number | null; at: string }) => void; onCancel: () => void }) {
  const timebox = type === '时间盒卡' && todayGoal !== null;
  const min = minToday, max = timebox ? Math.max(min, todayGoal! - 5) : 0;
  const [today, setToday] = useState(''), [rest, setRest] = useState(plainText(original));
  const [todayMinutes, setTodayMinutes] = useState(timebox ? Math.min(max, Math.max(min, Math.round(todayGoal! * 0.6 / 5) * 5)) : 0);
  const ok = today.trim().length > 0 && rest.trim().length > 0 && (!timebox || todayGoal! - todayMinutes >= 5);
  const submit = () => {
    if (!ok) return;
    onConfirm({ todayContent: today.trim(), restContent: rest.trim(), restMinutes: timebox ? todayGoal! - todayMinutes : null, at: new Date().toISOString() });
  };
  return <Dialog en="SHRINK · 缩小" title="今天先做一部分" onClose={onCancel}
    footer={<><Button onClick={onCancel}>不缩了</Button><Button tone="ink" disabled={!ok} onClick={submit}>缩小</Button></>}>
    原来这一项是「{plainText(original)}」{timebox ? `，今天 ${todayGoal} 分钟` : ''}。
    {timebox && <div className="dlg-field">
      <Slider label="今天做多少" value={todayMinutes} min={min} max={max} step={5} unit="MIN" onChange={setTodayMinutes} ticks={8} />
      <small className="dlg-hint">剩下 {todayGoal! - todayMinutes} 分钟放回背包</small>
    </div>}
    <div className="dlg-field">
      <label htmlFor="split-today">今天做的（接着计）</label>
      <TextInput id="split-today" autoFocus value={today} placeholder="写清楚今天做到哪，例如：只读 4.1–4.3"
        onChange={e => setToday(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }} />
    </div>
    <div className="dlg-field">
      <label htmlFor="split-rest">剩下的（放回背包，排在后面）</label>
      <TextInput id="split-rest" value={rest} placeholder="例如：4.4 以后和练习"
        onChange={e => setRest(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }} />
    </div>
    <small className="dlg-hint">剩下的那一份变成这个任务里的新一项，不在今天的板子上。可以一直往下拆，不限次数。</small>
  </Dialog>;
}
