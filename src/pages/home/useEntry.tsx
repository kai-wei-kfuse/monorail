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
  const [focused, setFocused] = useState(false), [editing, setEditing] = useState(false);
  const [note, setNote] = useState<ReadoutNote | null>(null);
  const gid = useId(), input = useRef<HTMLInputElement>(null), cancel = useRef(false), skip = useRef(false), wantPendingFocus = useRef(false);

  const { entry, pending } = view;
  const running = entry && !view.idle ? entry : null, cardRun = !!running?.cardId, deciding = pending !== null;
  const locked = cardRun && !deciding, isFrozen = !!view.away && !deciding;
  const kind = deciding ? 'pending' as const : !running ? 'idle' as const : running.kind !== '普通' ? 'away' as const : 'focus' as const;
  const focusInput = () => setTimeout(() => input.current?.focus(), 0);
  const prevPendingId = useRef<string | null>(pending?.id ?? null);

  // 读数下面那一行说的是改读数时那一条；换成别的事、开始或放弃了待确认，就不再显示。
  // 当通过「＋ / 写别的 / 开始」显式发起 beginPending 并由 store 实际提交出 pending 后，自动初始化草稿并聚焦输入框；
  // 当已提交的 pending 被放弃清空（pending 从有变无）时，复位本地草稿与焦点状态。
  useEffect(() => {
    setNote(null);
    if (prevPendingId.current && !pending) {
      wantPendingFocus.current = false;
      setFocused(false);
      setEditing(false);
      setText('');
      setProject('未分类');
      setTags([]);
    } else if (pending && wantPendingFocus.current) {
      wantPendingFocus.current = false;
      setEditing(false);
      setText('');
      setProject('未分类');
      setTags([]);
      setFocused(true);
      focusInput();
    }
    prevPendingId.current = pending?.id ?? null;
  }, [entry?.id, pending?.id, view.away?.id]);

  function begin() {
    if (locked || isFrozen) return;
    if (focused) return;
    setFocused(true); setNote(null);
    const edit = !wantPendingFocus.current && !!running && !view.away && !deciding;
    setEditing(edit);
    if (edit) { setText(running.description); setProject(running.project); setTags(running.tags); }
    else {
      if (!pending && !wantPendingFocus.current) actions.beginPending();
      wantPendingFocus.current = false;
      if (!pending) { setText(''); setProject('未分类'); setTags([]); }
    }
  }
  function end(e: FocusEvent) {
    const rel = e.relatedTarget as { closest?: (selector: string) => unknown } | null;
    if (rel && typeof rel.closest === 'function') {
      if (rel.closest(`[data-entry="${gid}"]`)) return;
      if (deciding && rel.closest('[data-entry-keep]')) {
        wantPendingFocus.current = false;
        setFocused(false);
        return;
      }
      if (deciding && rel.closest('[data-entry-discard]')) {
        wantPendingFocus.current = false;
        setFocused(false);
        setText(''); setProject('未分类'); setTags([]);
        return;
      }
    }
    setFocused(false);
    wantPendingFocus.current = false;
    if (skip.current) { skip.current = false; return; }
    if (cancel.current) { cancel.current = false; if (!editing && pending) actions.cancelPending(pending.id); onCancel?.(); return; }
    if (locked || isFrozen) return;
    const p = parseEntryText(text, view.projects.map(o => o.name));
    const value = { description: p.description || '（无描述）', project: p.project ?? project, tags: [...new Set([...p.tags, ...tags])] };
    if (editing && running && !view.away) {
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
  // 显式新活动入口（点「＋」「写别的」或无返回目标时的「开始」）：
  // 待确认状态完全由已提交的 view.pending 决定；若已有 pending 则直接重置草稿并聚焦，若尚无则只派发一次 beginPending 并在 pending 提交后自动激活输入
  const next = () => {
    setNote(null);
    setEditing(false);
    setText('');
    setProject('未分类');
    setTags([]);
    if (pending) {
      wantPendingFocus.current = false;
      setFocused(true);
      focusInput();
      return;
    }
    wantPendingFocus.current = true;
    actions.beginPending();
  };

  const showDraft = (focused || deciding) && !locked && !isFrozen;
  return {
    running, cardRun, deciding, locked, isFrozen, kind, focused, editing, note, setNote, input,
    /** 正在输入框里写的字（不在写时是 null），卡区照着显示。 */
    draft: showDraft ? text : null,
    groupProps: { 'data-entry': gid, onFocus: begin, onBlur: end },
    inputProps: { ref: input, value: showDraft ? text : running && !deciding ? running.description : '', readOnly: locked || isFrozen,
      onChange: (e: { target: { value: string } }) => setText(e.target.value), onKeyDown: keys },
    projectValue: showDraft ? project : running && !deciding ? running.project : '未分类',
    tagsValue: showDraft ? tags : running && !deciding ? running.tags : [],
    // 正在改正在计的这一条时，项目、标签一选就生效；底层冻结条目不调 editOpen
    pickProject: (v: string) => { setProject(v); if (editing && running && !view.away) actions.editOpen(running.id, { project: v }); },
    pickTags: (v: string[]) => { setTags(v); if (editing && running && !view.away) actions.editOpen(running.id, { tags: v }); },
    keys,
    /** 选了自动完成里的一项：不按离开写盘，直接做这件事。 */
    choose: (fn: () => void) => { skip.current = true; fn(); leave(); },
    focusInput,
    next,
  };
}

/** 读数下面的一行说明（UI 规范 §11.2「下面一行说明」），两种布局都用。 */
export function EntryLine({ view, note }: { view: TimerView; note: ReadoutNote | null }) {
  const { entry, pending, paused } = view, running = entry && !view.idle ? entry : null;
  return <>
    {pending ? <span>从 <b>{hms(pending.startedAt)}</b> 起已在计时，还没写盘。{view.waitingCard ? '点卡上的〔开始〕' : '写下在做什么'}（或选收藏），这段时间就算在那件事上{running ? `；「${running.description}」算到 ${hms(pending.startedAt)} 为止` : ''}</span>
      : running ? <span>开始于 <b>{hm(running.startedAt)}</b> · 记到项目「{running.project}」{running.tags.length ? ' · ' + running.tags.map(t => '#' + t).join(' ') : ''}</span>
      : paused ? <span>已暂停：「{paused}」，点「继续」接着计</span> : view.looseIdle ? <span>没在计时。写下在做什么，或者点〔开始〕</span> : <span>没在做事，正在计待机</span>}
    {note && <HitNote note={note} />}
  </>;
}
