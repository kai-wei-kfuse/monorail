import { useState } from 'react';
import { Button } from '../../ui/controls/Button';
import { TextInput } from '../../ui/controls/TextInput';
import './review.css';

/** 新想法入池：可以主动加新想法，全部进入活跃池（允许暂时超过上限，接下来的擂台会压回）。 */
export function NewIdeas({ added, onAdd }: { added: string[]; onAdd: (text: string, at: string) => void }) {
  const [text, setText] = useState('');
  const add = () => { const t = text.trim(); if (t) { onAdd(t, new Date().toISOString()); setText(''); } };
  return <>
    <div className="rv-add">
      <TextInput aria-label="新想法" autoFocus placeholder="写一个想法，Enter 加入" value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }} />
      <Button tone="ink" disabled={!text.trim()} onClick={add}>加入想法池</Button>
    </div>
    {added.length > 0 ? <ul className="ls">{added.map((t, i) => <li key={i} className="ls-item"><div><b>{t}</b></div></li>)}</ul>
      : <p className="ls-empty">没有新想法也可以直接下一步。</p>}
  </>;
}
