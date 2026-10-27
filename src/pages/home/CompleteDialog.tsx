import { useState } from 'react';
import { Dialog } from '../../ui/overlay/Dialog';
import { Button } from '../../ui/controls/Button';
import { Switch } from '../../ui/controls/Switch';
import { TextInput } from '../../ui/controls/TextInput';
import './home.css';

/**
 * 完成：一行「做到哪了」（可以留空），下面一个「还要接着做」开关（默认关）。
 * 缩小卡完成时不显示这个开关，因为上一级的卡会自动回来（附录 A6）。
 * at 是点〔完成〕的那一刻，原样带回：卡的计时段结束在那一刻，填写的这段时间算下一张卡的待机（附录 A2）。
 */
export function CompleteDialog({ at, isShrinkCard, onConfirm, onCancel }:
  { at: string; isShrinkCard: boolean; onConfirm: (r: { note: string; continueCard: boolean; at: string }) => void; onCancel: () => void }) {
  const [note, setNote] = useState(''), [again, setAgain] = useState(false);
  const submit = () => onConfirm({ note: note.trim(), continueCard: !isShrinkCard && again, at });
  return <Dialog en="COMPLETE" title="完成" onClose={onCancel}
    footer={<><Button onClick={onCancel}>还没完</Button><Button tone="ink" onClick={submit}>完成</Button></>}>
    <div className="dlg-field">
      <label htmlFor="done-note">做到哪了</label>
      <TextInput id="done-note" autoFocus value={note} placeholder="可以留空" onChange={e => setNote(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }} />
    </div>
    {!isShrinkCard && <div className="dlg-switch">
      <div><b>还要接着做</b><p>生成一张同内容的新卡放到队尾，带上这次的「做到哪了」。</p></div>
      <Switch label="还要接着做" checked={again} onChange={setAgain} />
    </div>}
  </Dialog>;
}
