import { useState } from 'react';
import { ActionButton } from '../../ui/controls/Button';
import { ProjectPicker } from '../../ui/controls/ProjectPicker';
import { TagPicker } from '../../ui/controls/TagPicker';
import { plainText } from '../../ui/marks/MarkedText';
import { formatReadout } from '../../shared/duration';
import { cardProgress } from '../../widgets/cardProgress';
import type { CardLook } from './CardFrame';
import { TaskCard } from './TaskCard';
import { HitNote, TimeField } from './TimeField';
import type { ReadoutNote } from './TimeField';
import type { TimerActions, TimerView } from './TimerBar';

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const hms = (iso: string) => `${hm(iso)}:${pad(new Date(iso).getSeconds())}`;

/**
 * 分开布局卡区里的自由记录卡（原型 stage.js 的 FreeCard）：照着计时条显示这件事，外观和任务卡一样。
 * draft 是计时条里正在写的字；over 是抽到还没开始的卡。正在计自己写的事时，双击标题改名，「记到」一行点一下就改，读数点一下直接改。
 * 待确认和暂停中，「记到」一行跟着计时条，这里不能改。
 */
export function FreeCard({ view, draft, over, now, look, titleScale, actions }:
  { view: TimerView; draft: string | null; over: { id: string; content: string } | null; now: number; look: CardLook; titleScale: number; actions: TimerActions }) {
  const [note, setNote] = useState<ReadoutNote | null>(null);
  const { entry, pending, paused } = view;
  const running = entry && !view.idle ? entry : null, away = running?.kind === '插入';
  const name = pending ? draft ?? '' : running ? draft ?? running.description : paused ?? '';
  const ms = Math.max(0, now - Date.parse(pending?.startedAt ?? entry?.startedAt ?? new Date(now).toISOString()));
  const progress = cardProgress(ms, null, !!running || !!pending, away || (!running && !pending));
  const [label, state] = pending ? ['待确认', ['待确认 · 已在计时', 'PENDING'] as const] : !running ? ['已暂停', ['已暂停', 'PAUSED'] as const]
    : away ? ['离开中', ['离开中', 'AWAY'] as const] : ['正在做', ['进行中', 'RUNNING'] as const];
  const editable = running && !pending ? running : null;

  const corner = <>
    {away && <button type="button" className="c-link" onClick={actions.resume}>回来 · {running?.description}</button>}
    {over && !pending && <><span className="c-hint">抽到的「{plainText(over.content)}」还没开始</span>
      <button type="button" className="c-link" onClick={() => actions.startCard(over.id)}>开始这张卡</button></>}
    {over && pending && <span className="c-hint">写好后「{plainText(over.content)}」放回卡池；清空输入框就回到卡</span>}
  </>;
  const picks = <span className="c-meta c-picks">记到
    <ProjectPicker flat id="free-project" value={editable?.project ?? '未分类'} options={view.projects} disabled={!editable}
      onChange={project => editable && actions.editOpen(editable.id, { project })} onCreate={actions.createProject} />
    <TagPicker flat id="free-tags" value={editable?.tags ?? []} options={view.knownTags} disabled={!editable}
      onChange={tags => editable && actions.editOpen(editable.id, { tags })} onCreate={actions.createTag} />
  </span>;
  const line = pending ? <><b>已在计时</b>从 {hms(pending.startedAt)} 起，还没写盘</>
    : !running ? <><b>已暂停</b>点〔继续〕接着计</> : <><b>开始于</b>{hm(running.startedAt)}</>;

  return <TaskCard look={look} titleScale={titleScale} corner={corner} meta="自由记录" picks={running && !pending ? picks : undefined} stateText={state}
    placeholder="在上面写下在做什么…"
    view={{ id: editable?.id, slotNo: '—', task: label, type: '结果卡', goalMinutes: null, content: name, elapsedMs: ms, progress }}
    onEditContent={editable && draft === null ? (id, description) => actions.editOpen(id, { description }) : undefined}
    note={<p className="c-note">{line}{note && <> <HitNote note={note} /></>}</p>}
    digits={<TimeField id="free-elapsed" kind="mmss" shown={ms} disabled={!running && !pending} submit={actions.readout} onNote={setNote}
      target={() => pending ? { mode: 'pending', id: pending.id } : running ? { mode: 'entry', id: running.id } : null}>{formatReadout(ms, 'mmss')}</TimeField>}
    actions={<>
      {pending ? <ActionButton cn="放弃" en="DISCARD" icon="x" title="放弃这次计时，这段时间照旧" onClick={() => actions.cancelPending(pending.id)} />
        : !running ? <ActionButton primary cn="继续" en="RESUME" icon="play" onClick={actions.resume} />
        : away ? <ActionButton primary cn="回来" en="BACK" icon="play" onClick={actions.resume} />
        : <ActionButton primary cn="暂停" en="PAUSE" icon="pause" onClick={actions.pause} />}
      <ActionButton primary={!!pending} cn="抽一张卡" en="DRAW" icon="cards" disabled={!view.canDraw} onClick={actions.draw} />
    </>} />;
}
