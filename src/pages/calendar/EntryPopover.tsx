import { useEffect, useState } from 'react';
import { Button } from '../../ui/controls/Button';
import { TextInput } from '../../ui/controls/TextInput';
import { InlineCell } from '../../ui/controls/InlineCell';
import { ProjectPicker } from '../../ui/controls/ProjectPicker';
import type { ProjectOption } from '../../ui/controls/ProjectPicker';
import { TagPicker } from '../../ui/controls/TagPicker';
import { Icon } from '../../ui/icons/Icon';
import { formatClock as clock, formatEntryDuration } from '../../shared/duration';
import type { EntryPatch } from '../../shared/duration';
import type { CalEntry } from './CalendarBoard';
import './calendar.css';

export type { EntryPatch };
/** 起止和时长交的是输入的原文（9:30、1h 30m），由接线层交给计时系统解析；出错由接线层报告，格子回到原值。 */
export interface PopoverActions {
  onPatch: (patch: EntryPatch) => void; onContinue: () => void; onCopy: () => void; onFavorite: () => void;
  onSaveAsCard: () => void; onDelete: () => void; onCreateProject: (name: string) => void; onCreateTag: (tag: string) => void;
  onSetStart: (text: string) => void; onSetEnd: (text: string) => void; onSetDuration: (text: string) => void;
}

/**
 * 点开一条条目的弹窗：改描述、开始、结束、时长、项目、标签；继续、复制、设为收藏、存为卡、删除。
 * 描述和时间都在点别处或回车时才提交，Esc 放弃这一格。时间格的规则和列表行一样（0.3.0-beta.3 D3）：
 * 正在计时的只能改开始，结束写 NOW，结束和时长只读。改完弹窗不关，格子跟着新数据刷新。
 * 来自卡的条目，描述和项目跟着卡，这里不能改，也不能存为卡；正在计时的不能复制、删除。Esc（不在输入格里时）关闭。
 */
export function EntryPopover({ entry, x, y, now, projects, knownTags, onClose, ...act }:
  { entry: CalEntry & { tags: string[] }; x: number; y: number; now: number; projects: ProjectOption[]; knownTags: string[]; onClose: () => void } & PopoverActions) {
  const [text, setText] = useState(entry.description);
  const running = entry.ended_at === null, fromCard = entry.card_id !== null;
  const start = Date.parse(entry.started_at), end = running ? now : Date.parse(entry.ended_at!);
  useEffect(() => setText(entry.description), [entry.id, entry.description]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  const commitText = () => { const t = text.trim(); if (t && t !== entry.description) act.onPatch({ description: t }); else setText(entry.description); };
  const then = (fn: () => void) => () => { fn(); onClose(); };
  return <div className="cal-pop" style={{ left: Math.min(x, window.innerWidth - 350), top: Math.min(y, window.innerHeight - 330) }}
    onPointerDown={e => e.stopPropagation()}>
    <div className="cal-pop-head">
      <span className="k">ENTRY</span>
      <button type="button" className="cal-pop-x" title="关闭" onClick={onClose}><Icon name="x" /></button>
    </div>
    <div className="cal-pop-time">
      <InlineCell className="cal-tin" label="开始" value={clock(start)} onCommit={act.onSetStart} />
      <i>–</i>
      <InlineCell className="cal-tin" label="结束" value={running ? 'NOW' : clock(end)} readOnly={running} onCommit={act.onSetEnd} />
      <InlineCell className="cal-dur" label="时长" value={formatEntryDuration(end - start)} readOnly={running}
        title={running ? '正在计时，时长随时间增长' : '改时长：45:00、01:30:00、90、1h 30m'} onCommit={act.onSetDuration} />
    </div>
    <TextInput aria-label="描述" value={text} readOnly={fromCard} onChange={e => setText(e.target.value)} onBlur={commitText}
      onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }} />
    {fromCard && <p className="cal-note">来自卡：改内容请在首页双击卡标题</p>}
    <div className="cal-pop-row">
      <ProjectPicker flat value={entry.project} options={projects} disabled={fromCard} onChange={project => act.onPatch({ project })} onCreate={act.onCreateProject} />
      <TagPicker flat value={entry.tags} options={knownTags} onChange={tags => act.onPatch({ tags })} onCreate={act.onCreateTag} />
    </div>
    <div className="cal-pop-acts">
      <Button size="sm" tone="ink" onClick={then(act.onContinue)}>继续</Button>
      <Button size="sm" disabled={running} onClick={then(act.onCopy)}>复制</Button>
      <Button size="sm" onClick={then(act.onFavorite)}>设为收藏</Button>
      <Button size="sm" disabled={fromCard} title="新建一个只有一项的支线任务" onClick={then(act.onSaveAsCard)}>存为卡</Button>
      <Button size="sm" tone="danger" disabled={running} onClick={then(act.onDelete)}>删除</Button>
    </div>
  </div>;
}
