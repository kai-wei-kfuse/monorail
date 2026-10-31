import { useEffect, useRef, useState } from 'react';
import { Chip } from '../../ui/controls/Chip';
import { ProjectPicker } from '../../ui/controls/ProjectPicker';
import type { ProjectOption } from '../../ui/controls/ProjectPicker';
import { TagPicker } from '../../ui/controls/TagPicker';
import { Icon } from '../../ui/icons/Icon';
import { popupPlacement } from '../../ui/controls/picker';
import { formatReadout } from '../../shared/duration';
import type { EntryGroup, ListEntry } from './listGroups';
import '../../ui/overlay/overlay.css';
import './list.css';

export interface EntryPatch { description?: string; project?: string; tags?: string[] }
/** 列表页要的动作。改起止和时长交的是输入的原文（9:30、1h 30m），由接线层解析；解析不了就什么都不改，这一格回到原来的值。 */
export interface ListActions {
  patch(id: string, patch: EntryPatch): void;
  setStart(id: string, text: string): void;
  setEnd(id: string, text: string): void;
  setDuration(id: string, text: string): void;
  continueEntry(id: string): void;
  copy(id: string): void;
  favorite(id: string): void;
  saveAsCard(id: string): void;
  remove(id: string): void;
  createProject(name: string): void;
  createTag(tag: string): void;
}
export interface RowContext { now: number; projects: ProjectOption[]; knownTags: string[]; isIdle: (e: ListEntry) => boolean; overlaps: Set<string>; actions: ListActions }

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const duration = (ms: number) => formatReadout(ms, 'mmss');
const colorOf = (ctx: RowContext, name: string) => ctx.projects.find(p => p.name === name)?.color ?? 'var(--mute-2)';

/** 点别处或回车才提交的输入格。平时显示 value；改了以后交给 onCommit；Esc 放弃。 */
function Cell({ className, label, value, readOnly, title, onCommit }:
  { className: string; label: string; value: string; readOnly?: boolean; title?: string; onCommit: (text: string) => void }) {
  const [text, setText] = useState<string | null>(null), skip = useRef(false);
  const commit = () => {
    if (!skip.current && text !== null && text.trim() !== value) onCommit(text.trim());
    skip.current = false; setText(null);
  };
  return <input className={className} aria-label={label} title={title} value={text ?? value} readOnly={readOnly} spellCheck={false}
    onChange={e => setText(e.target.value)} onBlur={commit}
    onKeyDown={e => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === 'Escape') skip.current = true;
      if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
    }} />;
}

/** 每行的「⋯」：复制、设为收藏、存为卡、删除。正在计时的不能复制、删除；来自卡的不能存为卡。靠近窗口底部时向上开。 */
function Menu({ e, ctx }: { e: ListEntry; ctx: RowContext }) {
  const [open, setOpen] = useState(false), [up, setUp] = useState(false), box = useRef<HTMLDivElement>(null);
  const toggle = () => {
    const r = box.current?.getBoundingClientRect();
    if (r) setUp(popupPlacement(r, { width: window.innerWidth, height: window.innerHeight }, { width: 0, height: 180 }).includes('up'));
    setOpen(!open);
  };
  useEffect(() => {
    if (!open) return;
    const away = (ev: PointerEvent) => { if (!box.current?.contains(ev.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const running = e.ended_at === null, run = (fn: (id: string) => void) => () => { setOpen(false); fn(e.id); };
  return <div className="lv-menu-wrap" ref={box}>
    <button type="button" className="lv-ibtn" title="更多" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>⋯</button>
    {open && <div className={`ctx lv-menu${up ? ' up' : ''}`} role="menu">
      <button type="button" role="menuitem" disabled={running} onClick={run(ctx.actions.copy)}><span className="ck" />复制</button>
      <button type="button" role="menuitem" onClick={run(ctx.actions.favorite)}><span className="ck" />设为收藏</button>
      <button type="button" role="menuitem" disabled={e.card_id !== null} onClick={run(ctx.actions.saveAsCard)}><span className="ck" />存为卡（新建支线任务）</button>
      <hr />
      <button type="button" role="menuitem" disabled={running} onClick={run(ctx.actions.remove)}><span className="ck">×</span>删除</button>
    </div>}
  </div>;
}

/**
 * 列表里的一条：描述、项目、标签、起止、时长都能直接改，规则和日历一样（允许重叠，只让待机让位）。
 * 来自卡的：带「卡」标记，描述和项目跟着卡，不能在这里改，标签可以改。正在计时的：结束写 NOW，结束和时长不能改，开始可以改。
 */
export function EntryRow({ e, ctx }: { e: ListEntry; ctx: RowContext }) {
  const idle = ctx.isIdle(e), fromCard = e.card_id !== null, running = e.ended_at === null, a = ctx.actions;
  const start = Date.parse(e.started_at), end = running ? ctx.now : Date.parse(e.ended_at!);
  return <div className={`lv-row${running ? ' running' : ''}${idle ? ' idle' : ''}`}>
    <i className="lv-dot" style={{ background: colorOf(ctx, e.project) }} />
    <div className="lv-desc">
      <Cell className="lv-din" label="描述" value={e.description} readOnly={fromCard || idle} title={fromCard ? '来自卡：改内容请在首页双击卡标题' : undefined}
        onCommit={t => a.patch(e.id, { description: t || '（无描述）' })} />
      {fromCard && <span className="lv-flag">卡</span>}
      {ctx.overlaps.has(e.id) && <span className="lv-flag par" title="这段时间里同时还有别的事">并行</span>}
    </div>
    <ProjectPicker flat value={e.project} options={ctx.projects} disabled={fromCard || idle} onChange={project => a.patch(e.id, { project })} onCreate={a.createProject} />
    <TagPicker flat value={e.tags} options={ctx.knownTags} disabled={idle} onChange={tags => a.patch(e.id, { tags })} onCreate={a.createTag} />
    <span className="lv-time">
      <Cell className="lv-tin" label="开始" value={clock(start)} onCommit={t => a.setStart(e.id, t)} />
      <i>–</i>
      <Cell className="lv-tin" label="结束" value={running ? 'NOW' : clock(end)} readOnly={running} onCommit={t => a.setEnd(e.id, t)} />
    </span>
    <Cell className="lv-dur" label="时长" value={duration(end - start)} readOnly={running}
      title={running ? '正在计时，时长随时间增长' : '改时长：45:00、01:30:00、90、1h 30m'} onCommit={t => a.setDuration(e.id, t)} />
    <button type="button" className="lv-ibtn go" title="继续：用同样的描述、项目、标签开始一条新的" onClick={() => a.continueEntry(e.id)}><Icon name="play" /></button>
    <Menu e={e} ctx={ctx} />
  </div>;
}

/** 一组相同的条目：只有一条就直接显示；几条时显示一行合计（条数、最早开始到最晚结束、总时长），点条数展开成单条。 */
export function EntryGroupRows({ g, ctx, expanded, onToggle }: { g: EntryGroup<ListEntry>; ctx: RowContext; expanded: boolean; onToggle: () => void }) {
  if (g.entries.length === 1) return <EntryRow e={g.entries[0]} ctx={ctx} />;
  const last = g.entries[0];
  return <div className="lv-group">
    <div className={`lv-row sum${g.last === null ? ' running' : ''}`}>
      <i className="lv-dot" style={{ background: colorOf(ctx, last.project) }} />
      <div className="lv-desc">
        <button type="button" className="lv-count" aria-expanded={expanded} title={expanded ? '收起' : '展开这几条'} onClick={onToggle}>{g.entries.length}</button>
        <b>{last.description}</b>{last.card_id && <span className="lv-flag">卡</span>}
      </div>
      <span className="lv-cat"><i className="combo-dot" style={{ background: colorOf(ctx, last.project) }} />{last.project}</span>
      <span className="lv-tags">{last.tags.map(t => <Chip key={t} label={`#${t}`} />)}</span>
      <span className="lv-time static">{clock(g.first)}<i>–</i>{g.last === null ? 'NOW' : clock(g.last)}</span>
      <span className="lv-dur static">{duration(g.total)}</span>
      <button type="button" className="lv-ibtn go" title="继续" onClick={() => ctx.actions.continueEntry(last.id)}><Icon name="play" /></button>
      <span className="lv-menu-wrap" />
    </div>
    {expanded && <div className="lv-children">{g.entries.map(e => <EntryRow key={e.id} e={e} ctx={ctx} />)}</div>}
  </div>;
}
