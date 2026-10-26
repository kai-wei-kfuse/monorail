import { useState } from 'react';
import { ActionButton, Button } from '../../ui/controls/Button';
import { TextInput } from '../../ui/controls/TextInput';
import type { CardLook } from './CardFrame';
import { CardFrame } from './CardFrame';

/**
 * 休息卡（降级链第 3 层）：系统从休息池派一件事，只是建议，不打勾、不计数。
 * 点「回来」后只问一句「刚才实际干了什么」，回答写成这段时间的活动名。休息池空时引导添加。
 */
export function RestCard({ suggestion, look, onBack, onAddRest }:
  { suggestion: string | null; look: CardLook; onBack: (answer: string, at: string) => void; onAddRest: () => void }) {
  const [asking, setAsking] = useState<string | null>(null);
  const [answer, setAnswer] = useState(suggestion ?? '');
  const submit = () => { if (asking) onBack(answer.trim() || suggestion || '休息', asking); };
  return <CardFrame look={look} slotNo="休" slotLabel="REST">
    <div />
    <div className="alt-hero" data-fx="title">
      <span className="k" data-fx="decode">TAKE A BREAK</span>
      <h1>{suggestion ?? '去走走或者看看窗外'}</h1>
      <p>{suggestion ? '只是建议，换成别的放松方式也完全可以。想回来的时候点「回来」。' : '休息池还是空的。可以先添加几件让自己放松的小事。'}</p>
      {asking && <div className="alt-ask">
        <label htmlFor="rest-answer">刚才实际干了什么</label>
        <TextInput id="rest-answer" autoFocus value={answer} onChange={e => setAnswer(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
      </div>}
    </div>
    <div />
    <div className="foot"><div className="actions" data-fx="actions">
      {asking
        ? <><ActionButton primary cn="确定" en="CONFIRM" icon="check" onClick={submit} /><Button onClick={() => setAsking(null)}>还没好</Button></>
        : <ActionButton primary cn="回来" en="BACK" icon="play" onClick={() => setAsking(new Date().toISOString())} />}
      {!suggestion && !asking && <Button onClick={onAddRest}>添加休息项</Button>}
    </div></div>
  </CardFrame>;
}
