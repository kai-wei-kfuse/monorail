import { useState } from 'react';
import { Dialog } from '../../ui/overlay/Dialog';
import { Button } from '../../ui/controls/Button';
import { TextInput } from '../../ui/controls/TextInput';
import { plainText } from '../../ui/marks/MarkedText';
import './home.css';

export type CardType = '结果卡' | '时间盒卡';

/**
 * 缩小 = 今天先做一部分（ADR 0021 第 4 条，已定 50、54；UI 规范 §11.15「缩小对话框」，原型截图 v0.3.1-背包原型-21、22）。
 * 原来这一项拆成「今天做的」（留在原位、接着计）和「剩下的」（放回背包，排在后面）。
 * 时间盒：一根条子（已计 / 今天要做 / 剩下的）和「今天做多少」滑块（5 分钟一步，不能少于今天已计）；两份加起来等于原来今天的量。结果卡只写两句。
 * 不显示第几级，可以一直往下拆。确认时才写盘；取消不写。
 */
export function ShrinkDialog({ original, type, todayGoal, minToday, minutesToday = Math.max(0, minToday - 5), onConfirm, onCancel }:
  { original: string; type: CardType; todayGoal: number | null;
    /** 今天这份的下限（今天已计向上取到 5，和服务端同一个公式） */
    minToday: number;
    /** 今天已计（分钟，只用来画条子的已计那一段） */ minutesToday?: number;
    onConfirm: (r: { todayContent: string; restContent: string; restMinutes: number | null; at: string }) => void; onCancel: () => void }) {
  const timebox = type === '时间盒卡' && todayGoal !== null;
  const min = minToday, max = timebox ? Math.max(min, todayGoal! - 5) : 0;
  const [today, setToday] = useState(''), [rest, setRest] = useState(plainText(original));
  const [todayMinutes, setTodayMinutes] = useState(timebox ? Math.min(max, Math.max(min, Math.round(todayGoal! * 0.6 / 5) * 5)) : 0);
  const restMinutes = timebox ? todayGoal! - todayMinutes : null;
  const ok = today.trim().length > 0 && rest.trim().length > 0 && (!timebox || restMinutes! >= 5);
  const submit = () => {
    if (!ok) return;
    onConfirm({ todayContent: today.trim(), restContent: rest.trim(), restMinutes, at: new Date().toISOString() });
  };
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); };
  const pct = (m: number) => `${Math.max(0, Math.min(100, m / todayGoal! * 100))}%`;
  const spent = Math.min(minutesToday, todayMinutes);
  return <Dialog en="SHRINK · 缩小" title="今天先做一部分" wide onClose={onCancel}
    footer={<><Button onClick={onCancel}>不缩了</Button><Button tone="ink" disabled={!ok} onClick={submit}>缩小</Button></>}>
    <div className="shr">
      <div className="shr-orig"><span className="k">原来这一项</span><b>{plainText(original)}</b>
        <small>{timebox ? `时间盒 · 今天 ${todayGoal} 分钟 · 已计 ${Math.floor(minutesToday)} 分钟` : '结果卡'}</small></div>
      {timebox && <>
        <div className="shr-bar" aria-hidden="true">
          <span className="done" style={{ width: pct(spent) }} />
          <span className="a" style={{ width: pct(todayMinutes - spent) }}>{todayMinutes} 分</span>
          <span className="b">{restMinutes! > 0 ? `剩 ${restMinutes} 分` : ''}</span>
        </div>
        <label className="shr-range">今天做多少
          <input type="range" aria-label="今天做多少分钟" min={min} max={max} step={5} value={todayMinutes} onChange={e => setTodayMinutes(Number(e.target.value))} /></label>
      </>}
      <div className="shr-two">
        <div className="shr-half a"><span className="k">TODAY · 今天做的（接着计）</span>
          <TextInput id="split-today" autoFocus aria-label="今天做的" value={today} placeholder={timebox ? '写清楚今天做到哪，例如：只读 4.1–4.3' : '例如：只把 STAR 的框架列出来'}
            onChange={e => setToday(e.target.value)} onKeyDown={enter} />
          <span className="min">{timebox ? <>时间盒 <b>{todayMinutes}</b> 分钟</> : '结果卡 · 做完算今日达成'}</span></div>
        <div className="shr-half"><span className="k">REST · 剩下的（放回背包）</span>
          <TextInput id="split-rest" aria-label="剩下的" value={rest} placeholder="例如：4.4 以后和练习" onChange={e => setRest(e.target.value)} onKeyDown={enter} />
          <span className="min">{timebox ? <>时间盒 <b>{restMinutes}</b> 分钟</> : '结果卡'}</span></div>
      </div>
      <p className="shr-note">剩下的那一份变成这个任务里的新一项，排在今天这份后面，不在今天的板子上；进度条会多一段。{timebox ? `已经计的 ${Math.floor(minutesToday)} 分钟算在今天这一份里。` : ''}可以一直往下拆，不限次数。</p>
    </div>
  </Dialog>;
}
