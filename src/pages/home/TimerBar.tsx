import type { FocusEvent, KeyboardEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { parseEntryText } from '../../shared/tags';
import { ActionButton } from '../../ui/controls/Button';
import { ProjectPicker } from '../../ui/controls/ProjectPicker';
import type { ProjectOption } from '../../ui/controls/ProjectPicker';
import { Segmented } from '../../ui/controls/Segmented';
import { TagPicker } from '../../ui/controls/TagPicker';
import { Icon } from '../../ui/icons/Icon';
import { StatusLed } from '../../ui/marks/StatusLed';
import { Suggest } from './Suggest';
import type { SuggestData } from './suggestions';
import { HitNote, TimeField } from './TimeField';
import type { ReadoutNote, ReadoutOutcome, ReadoutRequest } from './TimeField';
import './timer.css';

/** 正在计的那一条（homeSlice.entry）。 */
export interface TimerEntry {
  id: string; description: string; project: string; tags: string[]; startedAt: string; cardId: string | null; kind: '普通' | '插入' | '暂停';
}
export interface TimerView {
  entry: TimerEntry | null;
  /** 正在计的是待机。 */
  idle: boolean;
  /** 待确认：从 startedAt 起在计时，还没写盘；id 标识这一轮，放弃时带上。 */
  pending: { id: string; startedAt: string } | null;
  /** 暂停中、点「继续」会接着计的那件事（回到目标）的描述；没有就是 null。 */
  paused: string | null;
  /** 首页上抽到的卡还在等〔开始〕。 */
  waitingCard: boolean;
  canDraw: boolean;
  projects: ProjectOption[];
  knownTags: string[];
  suggest: SuggestData;
}
export interface EntryValue { description: string; project: string; tags: string[] }
/** 都由 app/actions 补上点击时刻。 */
export interface TimerActions {
  /** 开始待确认；已经在待确认就什么都不做。＋ 也是它：当前这条照常计，确认新的事时在起点截断。 */
  beginPending: () => void;
  cancelPending: (pendingId: string) => void;
  startFree: (value: EntryValue) => void;
  /** 改正在计的这一条（自由记录；带卡的改卡）。只交改了的字段。 */
  editOpen: (entryId: string, patch: Partial<EntryValue>) => void;
  pause: () => void;
  resume: () => void;
  draw: () => void;
  startFavorite: (presetId: string) => void;
  startCard: (cardId: string) => void;
  continueEntry: (entryId: string) => void;
  /** 把这一条的描述、项目、标签存成收藏（预设，位置计时条）。 */
  favorite: (entryId: string) => void;
  readout: (req: ReadoutRequest, seen: unknown) => Promise<ReadoutOutcome>;
  /** 就地新建项目（自动配色，N4）。没给时项目选择里不能新建。 */
  createProject?: (name: string) => void;
  createTag: (tag: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const hms = (iso: string) => `${hm(iso)}:${pad(new Date(iso).getSeconds())}`;
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * 分开布局首页上方的计时条（UI 规范 §11.2，原型 home.js 的 useEntry + TimerBar）。
 * 点输入框和点抽卡是同一件事：从第一次点的那一刻起计时（待确认），确认做什么时才写盘。
 * 输入框、项目、标签算一组：焦点在组内移动不写盘，离开这一组才写盘。写了字就开始这件事；正在计时点进去是改这一条；
 * 没写字就离开，接着计待确认；Esc 放弃。带卡的那一条在这里只读，改卡在卡上改。
 * onDraft 把正在写的字交给下面的卡区照着显示（不在写时交 null）。manual 是「手动补录」时显示的表单，没给就不能切过去。
 */
export function TimerBar({ view, actions, mode, onMode, manual, onDraft }:
  { view: TimerView; actions: TimerActions; mode: 'timer' | 'manual'; onMode: (mode: 'timer' | 'manual') => void; manual?: ReactNode;
    onDraft?: (text: string | null) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const [text, setText] = useState(''), [project, setProject] = useState('未分类'), [tags, setTags] = useState<string[]>([]);
  const [focused, setFocused] = useState(false), [editing, setEditing] = useState(false), [note, setNote] = useState<ReadoutNote | null>(null);
  const group = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), cancel = useRef(false), skip = useRef(false);

  const { entry, pending, paused } = view;
  const running = entry && !view.idle ? entry : null, cardRun = !!running?.cardId, deciding = pending !== null, locked = cardRun && !deciding;
  const kind = deciding ? 'pending' : !running ? 'idle' : running.kind !== '普通' ? 'away' : 'focus';
  const draft = focused && !locked ? text : null;
  useEffect(() => { onDraft?.(draft); }, [draft, onDraft]);
  // 读数下面那一行说的是改读数时那一条；换成别的事、开始或放弃了待确认，就不再显示
  useEffect(() => { setNote(null); }, [entry?.id, pending?.id]);

  function begin() {
    if (focused) return;
    setFocused(true); setNote(null);
    if (locked) return;
    const edit = !!running && !deciding;
    setEditing(edit);
    if (edit) { setText(running.description); setProject(running.project); setTags(running.tags); }
    else { actions.beginPending(); setText(''); setProject('未分类'); setTags([]); }
  }
  function end(e: FocusEvent) {
    if (e.relatedTarget instanceof Node && group.current?.contains(e.relatedTarget)) return;
    setFocused(false);
    if (skip.current) { skip.current = false; return; }
    if (cancel.current) { cancel.current = false; if (!editing && pending) actions.cancelPending(pending.id); return; }
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
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); leave(); }
    if (e.key === 'Escape') { cancel.current = true; leave(); }
  };
  const choose = (fn: () => void) => { skip.current = true; fn(); leave(); };
  // 正在改正在计的这一条时，项目、标签一选就生效
  const pickProject = (v: string) => { setProject(v); if (editing && running) actions.editOpen(running.id, { project: v }); };
  const pickTags = (v: string[]) => { setTags(v); if (editing && running) actions.editOpen(running.id, { tags: v }); };

  const elapsed = Math.max(0, now - Date.parse(pending?.startedAt ?? entry?.startedAt ?? new Date(now).toISOString()));
  const sec = Math.floor(elapsed / 1000), [hh, mm, ss] = [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map(pad);
  const label = {
    pending: ['WAIT', 'PENDING', '待确认'], idle: paused ? ['PAUSE', 'PAUSED', '暂停中'] : ['IDLE', 'IDLE', '待机'],
    away: running?.kind === '暂停' ? ['PAUSE', 'PAUSED', '暂停中'] : ['AWAY', 'AWAY', '离开中'], focus: ['NOW', 'ELAPSED', '这一条'],
  }[kind];
  const focusInput = () => setTimeout(() => input.current?.focus(), 0);

  return <section className="tbar">
    <div className="tbar-head"><span className="k">TIMER<em>计时条</em></span>
      <span className="tbar-tip">{mode === 'manual' ? '补一段过去做过的事：开始、结束、时长填两项' : '点输入框就开始计时；写下在做什么，或者抽一张卡'}</span>
      <Segmented label="计时方式" value={mode} onChange={onMode} options={[{ value: 'timer', label: '计时' }, { value: 'manual', label: '手动补录', disabled: !manual }]} />
    </div>
    {mode === 'manual' ? manual : <>
      <div className="tbar-row">
        <div className="tbar-tag" data-kind={kind}><StatusLed kind={kind === 'pending' ? 'idle' : kind} /><span>{label[0]}</span></div>
        <div className="tbar-group" ref={group} onFocus={begin} onBlur={end}>
          <div className="tbar-input">
            <input id="what" ref={input} className={paused ? 'paused' : ''} aria-label="在做什么" autoComplete="off"
              value={focused && !locked ? text : running && !deciding ? running.description : ''} readOnly={locked}
              placeholder={deciding && view.waitingCard ? '或者写别的事（抽到的卡点〔开始〕就算它）' : paused ?? 'I am working on…'}
              onChange={e => setText(e.target.value)} onKeyDown={keys} />
            {paused && !focused && <span className="tbar-pills"><span className="tbar-pill">暂停中</span></span>}
            {running && !focused && !deciding && <span className="tbar-pills">
              {running.kind !== '普通' && <span className="tbar-pill">{running.kind === '插入' ? '离开中' : '暂停中'}</span>}
              {cardRun && <span className="tbar-pill is-card">卡</span>}
            </span>}
            {/* 设为收藏：收藏不关联卡，带卡的这条不给。按下时不抢焦点，免得进到「改这一条」 */}
            {running && !cardRun && !focused && !deciding && <button type="button" className="tbar-fav" tabIndex={-1} aria-label="设为收藏"
              title={`把「${running.description}」设为收藏（描述、项目、标签）`} onMouseDown={e => e.preventDefault()}
              onClick={() => actions.favorite(running.id)}><Icon name="pin" /></button>}
            {focused && !editing && !locked && <Suggest query={text} data={view.suggest}
              onFavorite={id => choose(() => actions.startFavorite(id))} onCard={id => choose(() => actions.startCard(id))}
              onRecent={id => choose(() => actions.continueEntry(id))} />}
          </div>
          <ProjectPicker id="tbar-project" value={focused ? project : running && !deciding ? running.project : '未分类'} options={view.projects}
            onChange={pickProject} onCreate={actions.createProject} disabled={locked} onKeyDown={keys} />
          <TagPicker id="tbar-tags" value={focused ? tags : running && !deciding ? running.tags : []} options={view.knownTags}
            onChange={pickTags} onCreate={actions.createTag} disabled={locked} onKeyDown={keys} />
        </div>
        <div className="tbar-time">
          <div className={`tbar-clock${kind === 'idle' ? ' idle' : ''}`}><span className="k">{label[1]}<em>{label[2]}</em></span>
            <b><TimeField id="elapsed" kind="hms" shown={elapsed} disabled={kind === 'idle'} submit={actions.readout} onNote={setNote}
              target={() => pending ? { mode: 'pending', id: pending.id } : running ? { mode: 'entry', id: running.id } : null}>
              {hh}:{mm}<small>:{ss}</small></TimeField></b>
          </div>
        </div>
        <div className="tbar-acts">
          {deciding ? <ActionButton compact cn="放弃" en="DISCARD" icon="x" title="放弃这次计时，这段时间照旧" onClick={() => actions.cancelPending(pending.id)} />
            : running ? <ActionButton primary compact cn="暂停" en="PAUSE" icon="pause" title="暂停，转为待机" onClick={actions.pause} />
            : paused ? <ActionButton primary compact cn="继续" en="RESUME" icon="play" title={`继续「${paused}」`} onClick={actions.resume} />
            : <ActionButton primary compact cn="开始" en="START" icon="play" title="开始计时，然后写下在做什么" onClick={() => input.current?.focus()} />}
          <button type="button" className="tbar-new" disabled={!running || deciding} aria-label="开始想下一件事"
            title="开始想下一件事：当前这条照常计，确认新的事后在这一刻截断" onClick={() => { actions.beginPending(); focusInput(); }}><Icon name="plus" /></button>
          <ActionButton compact cn="抽卡" en="DRAW" icon="cards" disabled={!view.canDraw} onClick={actions.draw} />
        </div>
      </div>
      <div className="tbar-sub">
        {deciding ? <span>从 <b>{hms(pending.startedAt)}</b> 起已在计时，还没写盘。{view.waitingCard ? '点卡上的〔开始〕' : '写下在做什么'}（或选收藏），这段时间就算在那件事上{running ? `；「${running.description}」算到 ${hms(pending.startedAt)} 为止` : ''}</span>
          : running ? <span>开始于 <b>{hm(running.startedAt)}</b> · 记到项目「{running.project}」{running.tags.length ? ' · ' + running.tags.map(t => '#' + t).join(' ') : ''}</span>
          : paused ? <span>已暂停：「{paused}」，点「继续」接着计</span> : <span>没在做事，正在计待机</span>}
        {note && <HitNote note={note} />}
      </div>
    </>}
  </section>;
}
