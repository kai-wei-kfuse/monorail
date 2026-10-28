import type { FocusEvent, KeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { parseEntryText } from '../../shared/tags';
import { HitNote } from './TimeField';
import type { ReadoutNote } from './TimeField';
import type { EntryValue, TimerActions, TimerView } from './TimerBar';

const pad = (n: number) => String(n).padStart(2, '0');
export const hm = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const hms = (iso: string) => `${hm(iso)}:${pad(new Date(iso).getSeconds())}`;
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * 首页的输入入口（原型 home.js 的 useEntry）：分开布局的计时条、融合布局的大卡共用这一份。
 * 点输入框和点抽卡是同一件事：从第一次点的那一刻起计时（待确认），确认做什么时才写盘。
 * 输入框、项目、标签算一组（groupProps 铺到组里每个元素上，可以不在同一个父元素里）：焦点在组内移动不写盘，离开这一组才写盘。
 * 写了字就开始这件事；正在计时点进去是改这一条；没写字就离开，接着计待确认；Esc 放弃（onCancel 随后调用）。带卡的那一条只读，改卡在卡上改。
 * next 是「＋」：当前这条照常计，开始想下一件事；不等待确认写进 store，下一次获焦就按新的一件事处理。
 */
export function useEntry(view: TimerView, actions: TimerActions, onCancel?: () => void) {
  const [text, setText] = useState(''), [project, setProject] = useState('未分类'), [tags, setTags] = useState<string[]>([]);
  const [focused, setFocused] = useState(false), [editing, setEditing] = useState(false), [note, setNote] = useState<ReadoutNote | null>(null);
  const gid = useId(), input = useRef<HTMLInputElement>(null), cancel = useRef(false), skip = useRef(false), fresh = useRef(false);

  const { entry, pending } = view;
  const running = entry && !view.idle ? entry : null, cardRun = !!running?.cardId, deciding = pending !== null, locked = cardRun && !deciding;
  const kind = deciding ? 'pending' as const : !running ? 'idle' as const : running.kind !== '普通' ? 'away' as const : 'focus' as const;
  // 读数下面那一行说的是改读数时那一条；换成别的事、开始或放弃了待确认，就不再显示
  useEffect(() => { setNote(null); }, [entry?.id, pending?.id]);

  function begin() {
    if (focused) return;
    setFocused(true); setNote(null);
    const next = fresh.current;
    fresh.current = false;
    if (locked && !next) return;
    const edit = !next && !!running && !deciding;
    setEditing(edit);
    if (edit) { setText(running.description); setProject(running.project); setTags(running.tags); }
    else { actions.beginPending(); setText(''); setProject('未分类'); setTags([]); }
  }
  function end(e: FocusEvent) {
    if (e.relatedTarget instanceof Element && e.relatedTarget.closest(`[data-entry="${gid}"]`)) return;
    setFocused(false);
    if (skip.current) { skip.current = false; return; }
    if (cancel.current) { cancel.current = false; if (!editing && pending) actions.cancelPending(pending.id); onCancel?.(); return; }
    if (locked) return;
    const p = parseEntryText(text, view.projects.map(o => o.name));
    const value = { description: p.description || '（无描述）', project: p.project ?? project, tags: [...new Set([...p.tags, ...tags])] };
    if (editing && running) {
      const patch: Partial<EntryValue> = {};
      if (value.description !== running.description) patch.description = value.description;
      if (value.project !== running.project) patch.project = value.project;
      if (!same(value.tags, running.tags)) patch.tags = value.tags;
      if (Object.keys(patch).length) actions.editOpen(running.id, patch);
    } else if (text.trim()) actions.startFree(value);
  }
  const leave = () => (document.activeElement as HTMLElement | null)?.blur();
  const keys = (e: KeyboardEvent<HTMLElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); leave(); }
    if (e.key === 'Escape') { cancel.current = true; leave(); }
  };
  const focusInput = () => setTimeout(() => input.current?.focus(), 0);

  return {
    running, cardRun, deciding, locked, kind, focused, editing, note, setNote, input,
    /** 正在输入框里写的字（不在写时是 null），卡区照着显示。 */
    draft: focused && !locked ? text : null,
    groupProps: { 'data-entry': gid, onFocus: begin, onBlur: end },
    inputProps: { ref: input, value: focused && !locked ? text : running && !deciding ? running.description : '', readOnly: locked,
      onChange: (e: { target: { value: string } }) => setText(e.target.value), onKeyDown: keys },
    projectValue: focused ? project : running && !deciding ? running.project : '未分类',
    tagsValue: focused ? tags : running && !deciding ? running.tags : [],
    // 正在改正在计的这一条时，项目、标签一选就生效
    pickProject: (v: string) => { setProject(v); if (editing && running) actions.editOpen(running.id, { project: v }); },
    pickTags: (v: string[]) => { setTags(v); if (editing && running) actions.editOpen(running.id, { tags: v }); },
    keys,
    /** 选了自动完成里的一项：不按离开写盘，直接做这件事。 */
    choose: (fn: () => void) => { skip.current = true; fn(); leave(); },
    focusInput,
    next: () => { fresh.current = true; focusInput(); },
  };
}

/** 读数下面的一行说明（UI 规范 §11.2「下面一行说明」），两种布局都用。 */
export function EntryLine({ view, note }: { view: TimerView; note: ReadoutNote | null }) {
  const { entry, pending, paused } = view, running = entry && !view.idle ? entry : null;
  return <>
    {pending ? <span>从 <b>{hms(pending.startedAt)}</b> 起已在计时，还没写盘。{view.waitingCard ? '点卡上的〔开始〕' : '写下在做什么'}（或选收藏），这段时间就算在那件事上{running ? `；「${running.description}」算到 ${hms(pending.startedAt)} 为止` : ''}</span>
      : running ? <span>开始于 <b>{hm(running.startedAt)}</b> · 记到项目「{running.project}」{running.tags.length ? ' · ' + running.tags.map(t => '#' + t).join(' ') : ''}</span>
      : paused ? <span>已暂停：「{paused}」，点「继续」接着计</span> : <span>没在做事，正在计待机</span>}
    {note && <HitNote note={note} />}
  </>;
}
