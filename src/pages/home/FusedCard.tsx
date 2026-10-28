import type { ReactNode } from 'react';
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
import type { TimerActions, TimerView } from './TimerBar';
import { EntryLine, useEntry } from './useEntry';

/**
 * 融合布局的大卡（UI 规范 §11.3，原型 stage.js 的 FusedCard）：计时条并进卡里，首页只有这一张。
 * 标题区就是输入框；抽到卡时显示卡的标题，点「写别的」换回输入框。项目、标签在卡头「记到」那一行：显示卡时改卡（cardPicks），
 * 输入框时和输入框算一组。放弃、抽卡、暂停、＋ 和卡的按钮（cardActions）在底部一排；读数点一下就地改。
 * card / cardView 是首页抽到的卡；换卡时由首页按 card.id 重建，「写别的」随之复位。corner 是卡头右边另加的提示。
 */
export function FusedCard({ view, card, cardView, now, look, titleScale, actions, cardPicks, cardActions, onEditContent, fx, corner, onManual }:
  { view: TimerView; card: { id: string; status: '待做' | '进行中'; content: string } | null; cardView: TaskCardView | null; now: number;
    look: CardLook; titleScale: number; actions: TimerActions; cardPicks?: ReactNode; cardActions?: ReactNode;
    onEditContent?: (cardId: string, content: string) => void; fx?: ReactNode; corner?: ReactNode; onManual: () => void }) {
  const [write, setWrite] = useState(false);
  const E = useEntry(view, actions, () => setWrite(false)), { running, kind } = E, { entry, pending, paused } = view;
  const s = fusedState(view, card, write), showCard = s.show === 'card' && !!card && !!cardView;
  const elapsed = Math.max(0, now - Date.parse(pending?.startedAt ?? entry?.startedAt ?? new Date(now).toISOString()));
  const writeOther = () => { setWrite(true); E.next(); };
  // 回到卡：卡在做时放弃「＋」开的待确认；卡还没开始，待确认留着，点〔开始〕就算这张卡
  const back = () => { if (pending && card?.status === '进行中') actions.cancelPending(pending.id); setWrite(false); };
  const discard = () => { if (pending) actions.cancelPending(pending.id); setWrite(false); };

  const total = showCard ? cardView.elapsedMs + (s.pendingOnCard ? elapsed : 0) : elapsed;
  const digits = <TimeField id="f-elapsed" kind="mmss" shown={total} disabled={!s.target} target={() => s.target} submit={actions.readout} onNote={E.setNote}>
    {formatReadout(total, 'mmss')}</TimeField>;
  const draw = (primary: boolean) => <ActionButton primary={primary} cn="抽一张卡" en="DRAW" icon="cards" disabled={!view.canDraw} onClick={actions.draw} />;
  const plus = <button type="button" className="tbar-new" aria-label="开始想下一件事" title="开始想下一件事：当前这条照常计，确认新的事后在这一刻截断"
    onClick={writeOther}><Icon name="plus" /></button>;
  const manual = <button type="button" className="c-link" title="补一段过去做过的事" onClick={onManual}>手动补录</button>;
  const line = <p className="f-sub"><EntryLine view={view} note={E.note} /></p>;

  if (showCard) {
    const progress = cardProgress(total, cardView.goalMinutes, s.onCard || s.pendingOnCard, s.paused || s.away);
    return <TaskCard look={look} titleScale={titleScale} fx={fx} picks={cardPicks} onEditContent={onEditContent} digits={digits}
      view={{ ...cardView, elapsedMs: total, progress, awayActivity: s.paused ? undefined : cardView.awayActivity }}
      stateText={s.pendingOnCard ? ['待开始 · 已在计时', 'PENDING'] : s.paused ? ['已暂停', 'PAUSED'] : undefined}
      note={<>{cardView.progressNote && <p className="c-note"><b>上次做到</b>{cardView.progressNote}</p>}{line}</>}
      corner={<>
        {(s.paused || s.away) && <button type="button" className="c-link" onClick={actions.resume}>{s.paused ? '继续计这张卡' : `回来 · ${entry?.description}`}</button>}
        <button type="button" className="c-link" title="不做这张卡，自己写一件别的事" onClick={writeOther}>写别的</button>
        {corner}{manual}
      </>}
      actions={<>
        {cardActions}
        {pending && <ActionButton compact cn="放弃" en="DISCARD" icon="x" title="放弃这次计时，这段时间照旧" onClick={discard} />}
        {s.paused ? <ActionButton compact cn="继续" en="RESUME" icon="play" onClick={actions.resume} />
          : s.onCard && <ActionButton compact cn="暂停" en="PAUSE" icon="pause" onClick={actions.pause} />}
        {s.onCard && plus}
      </>} />;
  }

  const label = { pending: '待确认', idle: paused ? '已暂停' : '现在做什么', away: '离开中', focus: '正在做' }[kind];
  const state = { pending: ['待确认 · 已在计时', 'PENDING'], idle: paused ? ['已暂停', 'PAUSED'] : ['待机', 'IDLE'],
    away: [`离开中 · ${running?.description}`, 'AWAY'], focus: ['进行中', 'RUNNING'] }[kind] as [string, string];
  const progress = cardProgress(elapsed, null, !!running || !!pending, kind === 'away' || (kind === 'idle' && !!paused));
  const placeholder = card?.status === '进行中' ? '接下来做什么（确认后卡在这一刻截断）' : card ? '写别的事（写好后抽到的卡放回卡池）' : 'I am working on…';
  const free = card && !write && card.status === '待做';
  return <TaskCard look={look} titleScale={titleScale} fx={fx} meta="自由记录" slotLabel="NOW" stateText={state} digits={digits} note={line}
    view={{ slotNo: '—', task: label, type: '结果卡', goalMinutes: null, content: '', elapsedMs: elapsed, progress }}
    picks={<span className="c-meta c-picks" {...E.groupProps}>记到
      <ProjectPicker flat id="f-project" value={E.projectValue} options={view.projects} onChange={E.pickProject} onCreate={actions.createProject}
        disabled={E.locked} onKeyDown={E.keys} />
      <TagPicker flat id="f-tags" value={E.tagsValue} options={view.knownTags} onChange={E.pickTags} onCreate={actions.createTag}
        disabled={E.locked} onKeyDown={E.keys} />
    </span>}
    title={<div className="f-input" {...E.groupProps}>
      <input id="what" className="f-title" aria-label="在做什么" autoComplete="off" {...E.inputProps} placeholder={placeholder} />
      {E.focused && !E.editing && !E.locked && <Suggest query={E.inputProps.value} data={view.suggest}
        onFavorite={id => E.choose(() => actions.startFavorite(id))} onCard={id => E.choose(() => actions.startCard(id))}
        onRecent={id => E.choose(() => actions.continueEntry(id))} />}
    </div>}
    corner={<>
      {kind === 'away' && <button type="button" className="c-link" onClick={actions.resume}>回来 · {running?.description}</button>}
      {card && write && <button type="button" className="c-link" title="不写了，回到抽到的卡" onClick={back}>回到卡</button>}
      {free && <><span className="c-hint">抽到的「{plainText(card.content)}」还没开始</span>
        <button type="button" className="c-link" onClick={() => actions.startCard(card.id)}>开始这张卡</button></>}
      {corner}{manual}
    </>}
    actions={pending ? <>{draw(!card)}<ActionButton compact cn="放弃" en="DISCARD" icon="x" title="放弃这次计时，这段时间照旧" onClick={discard} /></>
      : running ? <>{kind === 'away' ? <ActionButton primary cn="回来" en="BACK" icon="play" onClick={actions.resume} />
          : <ActionButton primary cn="暂停" en="PAUSE" icon="pause" title="暂停，转为待机" onClick={actions.pause} />}{plus}{draw(false)}</>
      : paused ? <><ActionButton primary cn="继续" en="RESUME" icon="play" title={`继续「${paused}」`} onClick={actions.resume} />{draw(false)}</>
      : <><ActionButton primary cn="开始" en="START" icon="play" title="开始计时，然后写下在做什么" onClick={() => E.input.current?.focus()} />{draw(false)}</>} />;
}
