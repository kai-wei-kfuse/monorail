import { useState } from 'react';
import { Dialog } from '../../ui/overlay/Dialog';
import { Button } from '../../ui/controls/Button';
import { Switch } from '../../ui/controls/Switch';
import { TextInput } from '../../ui/controls/TextInput';
import './home.css';

/**
 * 完成：一行「做到哪了」（可以留空），下面一个「还没做完，下次接着做」开关（默认关）。
 * 0.3.1（已定 5，ADR 0021 第 5 条）：接着做 = 同一张卡回到待做，进度和「做到哪了」留着；缩小拆出来的卡也可以接着做。
 * at 是点〔完成〕的那一刻，原样带回：卡的计时段结束在那一刻（附录 A2）。
 */
export function CompleteDialog({ at, onConfirm, onCancel }:
  { at: string; onConfirm: (r: { note: string; continueCard: boolean; at: string }) => void; onCancel: () => void }) {
  const [note, setNote] = useState(''), [again, setAgain] = useState(false);
  const submit = () => onConfirm({ note: note.trim(), continueCard: again, at });
  return <Dialog en="COMPLETE" title="完成" onClose={onCancel}
    footer={<><Button onClick={onCancel}>还没完</Button><Button tone="ink" onClick={submit}>{again ? '先停在这' : '完成'}</Button></>}>
    <div className="dlg-field">
      <label htmlFor="done-note">做到哪了</label>
      <TextInput id="done-note" autoFocus value={note} placeholder="可以留空" onChange={e => setNote(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }} />
    </div>
    <div className="dlg-switch">
      <div><b>还没做完，下次接着做</b><p>这张卡回到待做，进度和「做到哪了」留着。</p></div>
      <Switch label="还没做完，下次接着做" checked={again} onChange={setAgain} />
    </div>
  </Dialog>;
}
