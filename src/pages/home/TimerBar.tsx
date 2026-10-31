import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ActionButton } from '../../ui/controls/Button';
import { ProjectPicker } from '../../ui/controls/ProjectPicker';
import type { ProjectOption } from '../../ui/controls/ProjectPicker';
import { Segmented } from '../../ui/controls/Segmented';
import { TagPicker } from '../../ui/controls/TagPicker';
import { Icon } from '../../ui/icons/Icon';
import { StatusLed } from '../../ui/marks/StatusLed';
import { Suggest } from './Suggest';
import type { SuggestData } from './suggestions';
import { formatReadout } from '../../shared/duration';
import { TimeField } from './TimeField';
import type { ReadoutOutcome, ReadoutRequest } from './TimeField';
import { EntryLine, useEntry } from './useEntry';
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
  /** 停止：截断这一条转为待机，之后没有〔继续〕。 */
  stop: () => void;
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

/** 正在计时时「＋」的位置换成它（融合大卡也用）；不在计时时那里还是「＋」。 */
export function StopButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="tbar-new" aria-label="停止" title="停止计时，转为待机" onClick={onClick}><Icon name="stop" /></button>;
}

/**
 * 分开布局首页上方的计时条（UI 规范 §11.2，原型 home.js 的 TimerBar）。输入逻辑在 useEntry，融合布局的大卡也用它。
 * onDraft 把正在写的字交给下面的卡区照着显示（不在写时交 null）。manual 是「手动补录」时显示的表单，没给就不能切过去。
 */
export function TimerBar({ view, actions, mode, onMode, manual, onDraft }:
  { view: TimerView; actions: TimerActions; mode: 'timer' | 'manual'; onMode: (mode: 'timer' | 'manual') => void; manual?: ReactNode;
    onDraft?: (text: string | null) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const E = useEntry(view, actions), { entry, pending, paused } = view, { running, cardRun, deciding, locked, kind, focused, editing, draft } = E;
  useEffect(() => { onDraft?.(draft); }, [draft, onDraft]);

  const elapsed = Math.max(0, now - Date.parse(pending?.startedAt ?? entry?.startedAt ?? new Date(now).toISOString()));
  const readoutText = formatReadout(elapsed, 'mmss'), splitAt = readoutText.lastIndexOf(':');
  const headDigits = readoutText.slice(0, splitAt), tailSec = readoutText.slice(splitAt);
  const label = {
    pending: ['WAIT', 'PENDING', '待确认'], idle: paused ? ['PAUSE', 'PAUSED', '暂停中'] : ['IDLE', 'IDLE', '待机'],
    away: running?.kind === '暂停' ? ['PAUSE', 'PAUSED', '暂停中'] : ['AWAY', 'AWAY', '离开中'], focus: ['NOW', 'ELAPSED', '这一条'],
  }[kind];

  return <section className="tbar">
    <div className="tbar-head"><span className="k">TIMER<em>计时条</em></span>
      <span className="tbar-tip">{mode === 'manual' ? '补一段过去做过的事：开始、结束、时长填两项' : '点输入框就开始计时；写下在做什么，或者抽一张卡'}</span>
      <Segmented label="计时方式" value={mode} onChange={onMode} options={[{ value: 'timer', label: '计时' }, { value: 'manual', label: '手动补录', disabled: !manual }]} />
    </div>
    {mode === 'manual' ? manual : <>
      <div className="tbar-row">
        <div className="tbar-tag" data-kind={kind}><StatusLed kind={kind === 'pending' ? 'idle' : kind} /><span>{label[0]}</span></div>
        <div className="tbar-group" {...E.groupProps}>
          <div className="tbar-input">
            <input id="what" className={paused ? 'paused' : ''} aria-label="在做什么" autoComplete="off" {...E.inputProps}
              placeholder={deciding && view.waitingCard ? '或者写别的事（抽到的卡点〔开始〕就算它）' : paused ?? 'I am working on…'} />
            {paused && !focused && <span className="tbar-pills"><span className="tbar-pill">暂停中</span></span>}
            {running && !focused && !deciding && <span className="tbar-pills">
              {running.kind !== '普通' && <span className="tbar-pill">{running.kind === '插入' ? '离开中' : '暂停中'}</span>}
              {cardRun && <span className="tbar-pill is-card">卡</span>}
            </span>}
            {/* 设为收藏：收藏不关联卡，带卡的这条不给。按下时不抢焦点，免得进到「改这一条」 */}
            {running && !cardRun && !focused && !deciding && <button type="button" className="tbar-fav" tabIndex={-1} aria-label="设为收藏"
              title={`把「${running.description}」设为收藏（描述、项目、标签）`} onMouseDown={e => e.preventDefault()}
              onClick={() => actions.favorite(running.id)}><Icon name="pin" /></button>}
            {focused && !editing && !locked && <Suggest query={E.inputProps.value} data={view.suggest}
              onFavorite={id => E.choose(() => actions.startFavorite(id))} onCard={id => E.choose(() => actions.startCard(id))}
              onRecent={id => E.choose(() => actions.continueEntry(id))} />}
          </div>
          <ProjectPicker id="tbar-project" value={E.projectValue} options={view.projects}
            onChange={E.pickProject} onCreate={actions.createProject} disabled={locked} onKeyDown={E.keys} />
          <TagPicker id="tbar-tags" value={E.tagsValue} options={view.knownTags}
            onChange={E.pickTags} onCreate={actions.createTag} disabled={locked} onKeyDown={E.keys} />
        </div>
        <div className="tbar-time">
          <div className={`tbar-clock${kind === 'idle' ? ' idle' : ''}`}><span className="k">{label[1]}<em>{label[2]}</em></span>
            <b><TimeField id="elapsed" kind="mmss" shown={elapsed} disabled={kind === 'idle'} submit={actions.readout} onNote={E.setNote}
              target={() => pending ? { mode: 'pending', id: pending.id } : running ? { mode: 'entry', id: running.id } : null}>
              {headDigits}<small>{tailSec}</small></TimeField></b>
          </div>
        </div>
        <div className="tbar-acts">
          {pending ? <ActionButton compact cn="放弃" en="DISCARD" icon="x" title="放弃这次计时，这段时间照旧" onClick={() => actions.cancelPending(pending.id)} />
            : running ? <ActionButton primary compact cn="暂停" en="PAUSE" icon="pause" title="暂停，转为待机" onClick={actions.pause} />
            : paused ? <ActionButton primary compact cn="继续" en="RESUME" icon="play" title={`继续「${paused}」`} onClick={actions.resume} />
            : <ActionButton primary compact cn="开始" en="START" icon="play" title="开始计时，然后写下在做什么" onClick={() => E.input.current?.focus()} />}
          {running && !deciding ? <StopButton onClick={actions.stop} />
            : <button type="button" className="tbar-new" disabled={!!pending} aria-label="开始想下一件事" title="开始想下一件事" onClick={E.next}><Icon name="plus" /></button>}
          <ActionButton compact cn="抽卡" en="DRAW" icon="cards" disabled={!view.canDraw} onClick={actions.draw} />
        </div>
      </div>
      <div className="tbar-sub"><EntryLine view={view} note={E.note} /></div>
    </>}
  </section>;
}
