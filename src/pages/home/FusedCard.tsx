import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';
import { ActionButton } from '../../ui/controls/Button';
import { ProjectPicker } from '../../ui/controls/ProjectPicker';
import { TagPicker } from '../../ui/controls/TagPicker';
import { Icon } from '../../ui/icons/Icon';
import { plainText } from '../../ui/marks/MarkedText';
import { formatReadout } from '../../shared/duration';
import { cardProgress } from '../../widgets/cardProgress';
import type { CardLook } from './CardFrame';
import { fusedState } from './fused';
import { Suggest } from './Suggest';
import type { TaskCardView } from './TaskCard';
import { TaskCard } from './TaskCard';
import { TimeField } from './TimeField';
import { StopButton } from './TimerBar';
import type { TimerActions, TimerView } from './TimerBar';
import { EntryLine, useEntry } from './useEntry';

/**
 * 融合布局的大卡（UI 规范 §11.3，原型 stage.js 的 FusedCard）：计时条并进卡里，首页只有这一张。
 * 标题区就是输入框；抽到卡时显示卡的标题，〔＋〕换回输入框，写一件事回车。卡头〔插入事件〕交给首页（onInsertEvent）：插入卡马上落下，在插入卡上写。项目、标签在卡头「记到」那一行：显示卡时改卡（cardPicks），
 * 输入框时和输入框算一组。放弃、抽卡、暂停、停止 / ＋（正在计时显示停止，不在计时显示 ＋）和卡的按钮（cardActions）在底部一排；读数点一下就地改。
 * card / cardView 是首页抽到的卡；换卡时由首页按 card.id 重建，输入框状态随之复位。corner 是卡头右边另加的提示。
 */
export function FusedCard({ view, card, cardView, now, look, titleScale, actions, cardPicks, cardActions, onEditContent, onInsertEvent, fx, corner }:
  { view: TimerView; card: { id: string; status: '待做' | '进行中'; content: string } | null; cardView: TaskCardView | null; now: number;
    look: CardLook; titleScale: number; actions: TimerActions; cardPicks?: ReactNode; cardActions?: ReactNode;
    onEditContent?: (cardId: string, content: string) => void;
    /** 卡头〔插入事件〕（用户 2026-11-06）：首页马上落下插入卡、在插入卡上写；没给就照旧换回输入框 */ onInsertEvent?: () => void;
    fx?: ReactNode; corner?: ReactNode }) {
  const [write, setWrite] = useState(false);
  const E = useEntry(view, actions, () => setWrite(false)), { running, kind, isFrozen } = E, { entry, pending, paused } = view;
  const s = fusedState(view, card, write), showCard = s.show === 'card' && !!card && !!cardView;
  const endMs = pending ? now : entry?.endedAt ? Date.parse(entry.endedAt) : now;
  const elapsed = view.looseIdle && !pending ? 0 : Math.max(0, endMs - Date.parse(pending?.startedAt ?? entry?.startedAt ?? new Date(now).toISOString()));
  const writeOther = () => { setWrite(true); E.next(); };
  // 回到卡：卡在做时放弃「＋」开的待确认；卡还没开始，待确认留着，点〔开始〕就算这张卡
  const back = () => { if (pending && card?.status === '进行中') actions.cancelPending(pending.id); setWrite(false); };
  const discard = () => { if (pending) actions.cancelPending(pending.id); setWrite(false); };

  const total = showCard ? cardView.elapsedMs + (s.pendingOnCard ? elapsed : 0) : elapsed;
  const digits = <TimeField id="f-elapsed" kind="mmss" shown={total} disabled={!s.target} target={() => s.target} submit={actions.readout} onNote={E.setNote}>
    {formatReadout(total, 'mmss')}</TimeField>;
  // 0.3.1：抽卡只在今日任务板上（已定 41）；首页这个位置是〔今日任务板〕，点了拉开抽屉
  const draw = (primary: boolean) => view.taskMode === false ? null : <ActionButton primary={primary} cn="今日任务板" en="TODAY" icon="cards" onClick={actions.openBoard} />;
  const plus = <button type="button" className="tbar-new" aria-label="开始想下一件事" title="开始想下一件事" onClick={writeOther}><Icon name="plus" /></button>;
  const stop = <StopButton onClick={actions.stop} />;
  const line = <p className="f-sub"><EntryLine view={view} note={E.note} /></p>;

  if (showCard) {
    const progress = cardProgress(total, cardView.goalMinutes, s.onCard || s.pendingOnCard, s.paused || s.away);
    return <TaskCard look={look} titleScale={titleScale} fx={fx} picks={cardPicks} onEditContent={onEditContent} digits={digits} actionsDisabled={!!view.away}
      view={{ ...cardView, elapsedMs: total, progress, awayActivity: undefined }}
      stateText={s.pendingOnCard ? ['待开始 · 已在计时', 'PENDING'] : s.paused ? ['已暂停', 'PAUSED'] : s.away ? ['进行中（暂停）', 'PAUSED'] : undefined}
      note={<>{cardView.progressNote && <p className="c-note"><b>上次做到</b>{cardView.progressNote}</p>}{line}</>}
      corner={<>
        {s.paused && <button type="button" className="c-link" onClick={actions.continueTimer}>继续计这张卡</button>}
        {/* 〔插入事件〕（用户 2026-11-06）：同〔休息一下〕的样式；点下插入卡马上落下，在插入卡上写名字，回车记下，卡等你回来 */}
        <button type="button" className="c-rest" title="插一件别的事：插入卡马上落下，在上面写名字；这张卡等你回来" onClick={onInsertEvent ?? writeOther}><Icon name="plus" />插入事件</button>
        {corner}
      </>}
      actions={<>
        {cardActions}
        {pending && <ActionButton compact data-entry-discard="" cn="放弃" en="DISCARD" icon="x" title="放弃这次计时，这段时间照旧" onClick={discard} />}
        {s.paused ? <ActionButton compact cn="继续" en="RESUME" icon="play" onClick={actions.continueTimer} />
          : (s.onCard || s.away || !!view.away) && <ActionButton compact data-entry-keep="" cn="暂停" en="PAUSE" icon="pause" onClick={actions.pause} />}
        {s.onCard || s.away || !!view.away ? stop : null}
        {!pending && (!s.onCard || s.away) && plus}
      </>} />;
  }

  const awayFreeze = !!view.away && !E.deciding;
  const label = E.deciding ? '待确认' : !running ? (paused ? '已暂停' : '现在做什么') : '正在做';
  const state = (E.deciding ? ['待确认 · 已在计时', 'PENDING']
    : !running ? (paused ? ['已暂停', 'PAUSED'] : view.looseIdle ? ['没在计时', 'NOT TIMING'] : ['待机', 'IDLE'])
    : awayFreeze || kind === 'away' ? ['进行中（暂停）', 'PAUSED']
    : ['进行中', 'RUNNING']) as [string, string];
  const progress = cardProgress(elapsed, null, (!!running || E.deciding) && !awayFreeze, awayFreeze || kind === 'away' || (kind === 'idle' && !!paused));
  const placeholder = card?.status === '进行中' ? '接下来做什么（确认后卡在这一刻截断）' : card ? '写别的事（写好后抽到的卡放回卡池）' : 'I am working on…';
  const free = card && !write && card.status === '待做';
  const showSuggest = E.focused && !E.editing && !E.locked && !isFrozen;
  // 已输入内容（或正在计自由记录）且未展开建议框时，.f-input 与 .f-title 紧贴文字实际宽度（compact），使 L 形角标像任务卡一样紧贴文字
  const hasContent = Boolean(E.inputProps.value.trim());
  const compact = hasContent && !showSuggest;
  const baseTs = Math.max(26, Math.floor(96 * titleScale / 100));
  return <TaskCard look={look} titleScale={titleScale} fx={fx} meta="自由记录" slotLabel="NOW" stateText={state} digits={digits} note={line} actionsDisabled={!!view.away}
    view={{ slotNo: '—', task: label, type: '结果卡', goalMinutes: null, content: '', elapsedMs: elapsed, progress }}
    picks={<span className="c-meta c-picks" {...E.groupProps}>记到
      <ProjectPicker flat id="f-project" value={E.projectValue} options={view.projects} onChange={E.pickProject} onCreate={actions.createProject}
        disabled={E.locked || isFrozen} onKeyDown={E.keys} />
      <TagPicker flat id="f-tags" value={E.tagsValue} options={view.knownTags} onChange={E.pickTags} onCreate={actions.createTag}
        disabled={E.locked || isFrozen} onKeyDown={E.keys} />
    </span>}
    title={<div className={`f-input${compact ? ' compact' : ''}`} style={{ '--ts': `${baseTs}px` } as CSSProperties} {...E.groupProps}>
      <input id="what" className="f-title" aria-label="在做什么" autoComplete="off" {...E.inputProps} placeholder={placeholder} />
      {showSuggest && <Suggest query={E.inputProps.value} data={view.suggest}
        onFavorite={id => E.choose(() => actions.startFavorite(id))} onCard={id => E.choose(() => actions.startCard(id))}
        onRecent={id => E.choose(() => actions.continueEntry(id))} />}
    </div>}
    corner={<>
      {card && write && <button type="button" className="c-link" title="不写了，回到抽到的卡" onClick={back}>回到卡</button>}
      {free && <><span className="c-hint">抽到的「{plainText(card.content)}」还没开始</span>
        <button type="button" className="c-link" onClick={() => actions.startCard(card.id)}>开始这张卡</button></>}
      {corner}
    </>}
    actions={E.deciding ? <>
        {draw(!card)}
        {pending && <ActionButton compact data-entry-discard="" cn="放弃" en="DISCARD" icon="x" title="放弃这次计时，这段时间照旧" onClick={discard} />}
        {view.away && <><ActionButton compact data-entry-keep="" cn="暂停" en="PAUSE" icon="pause" title="暂停，转为待机" onClick={actions.pause} />{stop}</>}
      </>
      : running ? <><ActionButton primary data-entry-keep="" cn="暂停" en="PAUSE" icon="pause" title="暂停，转为待机" onClick={actions.pause} />{stop}{view.away && plus}{draw(false)}</>
      : view.away ? <><ActionButton primary cn="开始" en="START" icon="play" title="开始计时，然后写下在做什么" onClick={E.next} />{stop}{plus}{draw(false)}</>
      : paused ? <><ActionButton primary cn="继续" en="RESUME" icon="play" title={`继续「${paused}」`} onClick={actions.continueTimer} />{plus}{draw(false)}</>
      : <><ActionButton primary cn="开始" en="START" icon="play" title="开始计时，然后写下在做什么" onClick={E.next} />{plus}{draw(false)}</>} />;
}
