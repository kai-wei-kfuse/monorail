import { useState } from 'react';
import { Dialog } from '../../ui/overlay/Dialog';
import { Button } from '../../ui/controls/Button';
import { Segmented } from '../../ui/controls/Segmented';
import { Slider } from '../../ui/controls/Slider';
import { TextInput } from '../../ui/controls/TextInput';
import { plainTitle } from './title';
import './home.css';

/** 设计文档「降级链」里的缩小常见模式，只作参考。 */
export const SHRINK_PATTERNS = [
  ['完成 → 进度', '写完一道算法题', '写 1 小时算法题并记下思路'],
  ['解决 → 记录', '修好打印机', '排查打印机，记录过程留待下次'],
  ['前进 → 回顾', '沿 Python 往下学 1 小时', '不再往后学，给今天学的内容出几道题做完'],
  ['整体 → 一块', '改完整份简历', '只改一段项目经历'],
  ['执行 → 准备', '给小游戏实现房间系统', '写下房间系统的接口设计'],
  ['产出 → 起头', '写 1000 字', '列提纲并写第一段'],
] as const;

export type CardType = '结果卡' | '时间盒卡';

/**
 * 缩小：缩成什么由我自己写。旁边有「结果 / 时间盒」切换，默认沿用原卡的类型。
 * 确认时才算一次拒绝（附录 A7），所以 at 取点「缩小」确认的那一刻；取消不计数。
 * 级数显示「第 N 级 / 共 M 级」；达到上限时首页的缩小按钮已经置灰，不会打开这里。
 */
export function ShrinkDialog({ original, type, timeboxMinutes, level, maxLevel, defaultTimebox, onConfirm, onCancel }:
  { original: string; type: CardType; timeboxMinutes: number | null; level: number; maxLevel: number; defaultTimebox: number;
    onConfirm: (r: { content: string; type: CardType; timeboxMinutes: number | null; at: string }) => void; onCancel: () => void }) {
  const [content, setContent] = useState(''), [kind, setKind] = useState<CardType>(type);
  const [minutes, setMinutes] = useState(timeboxMinutes ?? defaultTimebox);
  const ok = content.trim().length > 0;
  const submit = () => { if (ok) onConfirm({ content: content.trim(), type: kind, timeboxMinutes: kind === '时间盒卡' ? minutes : null, at: new Date().toISOString() }); };
  return <Dialog en={`SHRINK ${level + 1} / ${maxLevel}`} title="缩小成什么" onClose={onCancel}
    footer={<><Button onClick={onCancel}>不缩了</Button><Button tone="ink" disabled={!ok} onClick={submit}>缩小</Button></>}>
    自我感觉无法完成，可以主动降低标准。原来是「{plainTitle(original)}」。
    <div className="dlg-field">
      <label htmlFor="shrink-to">缩小后（第 {level + 1} 级，最多 {maxLevel} 级）</label>
      <TextInput id="shrink-to" autoFocus value={content} placeholder="例如把「学 Python」改成「学 1 小时 Python」"
        onChange={e => setContent(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }} />
    </div>
    <div className="dlg-field dlg-inline">
      <Segmented label="类型" value={kind} onChange={setKind} options={[{ value: '结果卡', label: '结果' }, { value: '时间盒卡', label: '时间盒' }]} />
      {kind === '时间盒卡' && <Slider label="目标时长" value={minutes} min={5} max={240} step={5} unit="MIN" onChange={setMinutes} ticks={16} />}
    </div>
    <dl className="dlg-pat">{SHRINK_PATTERNS.map(([name, from, to]) => <div key={name}><dt>{name}</dt><dd>{from} → {to}</dd></div>)}</dl>
  </Dialog>;
}
