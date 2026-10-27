import { useState } from 'react';
import { Dialog } from '../../ui/overlay/Dialog';
import { Button } from '../../ui/controls/Button';
import { TextInput } from '../../ui/controls/TextInput';
import type { NoticeProps } from './types';
import { now } from './types';
import './notices.css';

/** 休息结束时只问一句「刚才实际干了什么」，回答写成这段时间的活动名。默认填系统派的那件事。 */
export function RestReturn({ data, resolve, dismiss }: NoticeProps<'restReturn'>) {
  const [answer, setAnswer] = useState(data.suggestion ?? '');
  const submit = () => resolve({ answer: answer.trim() || data.suggestion || '休息', at: now() });
  return <Dialog en="BACK" title="刚才实际干了什么" onClose={dismiss}
    footer={<><Button onClick={dismiss}>还没好</Button><Button tone="ink" onClick={submit}>回来</Button></>}>
    <div className="nt-field">
      <TextInput aria-label="刚才实际干了什么" autoFocus value={answer} onChange={e => setAnswer(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
    </div>
  </Dialog>;
}
