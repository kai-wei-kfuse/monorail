import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../store/appStore';
import type { HomeSlice } from '../../store/homeSlice';
import type { TopoMode } from '../../ui/effects/Topo';
import { Wipe } from '../../ui/effects/Wipe';
import { ActionButton } from '../../ui/controls/Button';
import { cardProgress } from '../../widgets/cardProgress';
import { LOOSE } from '../../shared/backpack';
import { TimeboxShort } from '../../widgets/notices/TimeboxShort';
import type { TaskCardView } from './TaskCard';
import { TaskCard } from './TaskCard';
import { CardActions } from './CardActions';
import { CompleteDialog } from './CompleteDialog';
import { ShrinkDialog } from './ShrinkDialog';
import { GuideCard } from './GuideCard';
import type { GuideKind } from './GuideCard';
import { RestCard } from './RestCard';
import { ConfirmLink } from './ConfirmLink';
import { ReviewCard } from './ReviewCard';
import { CardFrame } from './CardFrame';
import { playAfterWipe, playColdIntro, playResumeIntro } from './intro';

/** 首页需要的动作。由外壳的适配层（app/actions）提供，出错由适配层统一报告。 */
export interface HomeActions {
  start(cardId: string, at: string): Promise<unknown>;
  checkComplete(cardId: string, at: string): Promise<{ remainingMinutes: number; at: string } | undefined>;
  complete(cardId: string, at: string, note: string, keepGoing: boolean): Promise<unknown>;
  shrink(cardId: string, input: { content: string; type: '结果卡' | '时间盒卡'; minutes: number | null }, at: string): Promise<unknown>;
  redraw(cardId: string | null, at: string): Promise<unknown>;
  stopToday(at: string): Promise<unknown>;
  resume(at: string): Promise<unknown>;
  wake(at: string): Promise<unknown>;
  returnFromRest(answer: string, at: string): Promise<unknown>;
}
export interface HomeLook { titleScale: number; topoMode: TopoMode; topoDepth: number; shrinkMaxLevel: number; timeboxDefault: number }

/** 首页卡片的显示数据：closedEffectiveMs + (现在 − 当前段开始)。小窗也用它。 */
export function cardView(home: HomeSlice, now: number): TaskCardView | null {
  const c = home.card;
  if (!c) return null;
  const elapsedMs = home.closedEffectiveMs + (home.currentSegStartedAt ? now - Date.parse(home.currentSegStartedAt) : 0);
  const away = home.awayActivity !== null;
  // 不属于项目的卡不占背包格，不显示「/03」
  return { slotNo: c.slotNo, slotOf: c.slotNo === LOOSE.slot ? undefined : c.slotOf, project: c.project, type: c.type, goalMinutes: c.goalMinutes, content: c.content,
    progressNote: c.progressNote || undefined, elapsedMs, awayActivity: home.awayActivity ?? undefined,
    progress: cardProgress(elapsedMs, c.goalMinutes, c.status === '进行中' && !away, away) };
}

/** 每秒刷新一次「现在」。 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  return now;
}

type Dialog = { kind: 'short'; cardId: string; remaining: number; at: string } | { kind: 'complete'; cardId: string; at: string } | { kind: 'shrink'; cardId: string } | null;

/**
 * 首页：只显示一件事。按 home.mode 显示任务卡、引导卡、休息卡、回顾卡，或「今天不再出卡」。
 * completeAt：小窗里点了完成、主窗口还原以后，由外壳传进来，接着走完成流程（架构 §5.5）。
 * shrinkFor：跳过信号里选了「拆小」，由外壳传进来卡 id，打开缩小对话框。
 */
export function HomePage({ actions, look, intro, completeAt, onCompleteConsumed, shrinkFor, onShrinkConsumed, onGuide, onOpenReview, onAddRest }:
  { actions: HomeActions; look: HomeLook; intro: { kind: 'cold' | 'resume' } | null; completeAt: string | null; onCompleteConsumed: () => void;
    shrinkFor: string | null; onShrinkConsumed: () => void;
    onGuide: (kind: GuideKind) => void; onOpenReview: () => void; onAddRest?: () => void }) {
  const home = useStore(appStore, s => s.home), cards = useStore(appStore, s => s.cards);
  const now = useNow();
  const stage = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  // 再抽一张：先冻结旧画面，换卡完成后用擂除盖住，盖住时才放出新卡（UI 规范 §8.3）
  const [frozen, setFrozen] = useState<TaskCardView | null>(null), [wipe, setWipe] = useState<{ no: string; meta: string; title: string } | null>(null);
  const cardLook = { topoMode: look.topoMode, topoDepth: look.topoDepth, paused: false };
  const live = cardView(home, now), view = frozen ?? live;
  const full = home.card ? cards.find(c => c.id === home.card!.id) : undefined;

  useLayoutEffect(() => {
    if (!stage.current || !intro) return;
    if (intro.kind === 'cold') return playColdIntro(document, stage.current, stage.current.querySelector('.digits'));
    else playResumeIntro(stage.current);
  }, [intro]);

  async function act(work: () => Promise<unknown>) { setBusy(true); try { await work(); } finally { setBusy(false); } }
  async function beginComplete(cardId: string, at: string) {
    const card = cards.find(c => c.id === cardId);
    if (card?.type === '时间盒卡') {
      const check = await actions.checkComplete(cardId, at);
      if (!check) return;
      if (check.remainingMinutes > 0) { setDialog({ kind: 'short', cardId, remaining: Math.ceil(check.remainingMinutes), at }); return; }
    }
    setDialog({ kind: 'complete', cardId, at });
  }
  useEffect(() => {
    if (!completeAt || !home.card) return;
    onCompleteConsumed();
    void beginComplete(home.card.id, completeAt);
  }, [completeAt]);
  useEffect(() => {
    if (!shrinkFor) return;
    onShrinkConsumed();
    if (home.card?.id === shrinkFor && home.card.shrink === 'ok') setDialog({ kind: 'shrink', cardId: shrinkFor });
  }, [shrinkFor]);

  async function redraw(at: string) {
    if (!home.card || !live) return;
    setFrozen(live);
    await act(() => actions.redraw(home.card!.id, at));
    const next = appStore.getState().home.card;
    if (!next) { setFrozen(null); return; }
    setWipe({ no: next.slotNo, meta: `${next.project} · ${next.type}${next.goalMinutes ? ` · ${next.goalMinutes} 分钟` : ''}`, title: next.content.replace(/[[\]]/g, '') });
  }

  let body;
  if (home.mode === 'rest') body = <RestCard suggestion={home.rest?.suggestion ?? null} look={cardLook} onAddRest={onAddRest} onBack={(answer, at) => void act(() => actions.returnFromRest(answer, at))} />;
  else if (home.mode === 'review' && home.review) body = <ReviewCard period={home.review.period} resumeStep={home.review.resumeStep || null} betDue={home.review.betDue} look={cardLook} onOpen={onOpenReview} />;
  else if (home.mode === 'stopped') body = <CardFrame look={cardLook} slotNo="停" slotLabel="STOPPED">
    <div />
    <div className="alt-hero" data-fx="title">
      <span className="k">NO MORE CARDS TODAY</span>
      <h1>{home.activity.label === '睡觉' ? '晚安' : '今天不再出卡'}</h1>
      <p>{home.activity.label === '睡觉' ? '醒来点「醒来」结束睡眠。' : '现在只作为计时工具使用，过了日边界自动恢复出卡。'}当前活动：{home.activity.label}。</p>
    </div>
    <div />
    <div className="foot"><div className="actions" data-fx="actions">
      {home.activity.label === '睡觉' && <ActionButton primary cn="醒来" en="WAKE" icon="play" onClick={() => void act(() => actions.wake(new Date().toISOString()))} />}
    </div></div>
  </CardFrame>;
  else if (home.mode === 'task' && view && home.card) {
    const running = home.card.status === '进行中', away = home.awayActivity !== null;
    const doneBaseline = home.baseline.side && home.baseline.main !== false;
    const corner = <>
      {away && <button type="button" className="c-link" onClick={() => void act(() => actions.resume(new Date().toISOString()))}>回来 · {home.awayActivity}</button>}
      {home.noMainHint && <span className="c-hint">还没有主线</span>}
      {doneBaseline && <ConfirmLink label="今天不再出卡" confirmLabel="确认今天不再出卡？" onConfirm={at => void act(() => actions.stopToday(at))} />}
    </>;
    body = <TaskCard view={view} look={cardLook} titleScale={look.titleScale} corner={corner}
      actions={<CardActions running={running} shrink={home.card.shrink} busy={busy || !!wipe}
        onStart={at => void act(() => actions.start(home.card!.id, at))}
        onComplete={at => void beginComplete(home.card!.id, at)}
        onShrink={() => setDialog({ kind: 'shrink', cardId: home.card!.id })}
        onRedraw={at => void redraw(at)} />}
      fx={wipe && <Wipe no={wipe.no} meta={wipe.meta} title={wipe.title} onCovered={() => setFrozen(null)}
        onDone={() => { setWipe(null); if (stage.current) playAfterWipe(stage.current); }} />} />;
  } else body = <GuideCard kind={home.mode === 'guide' ? home.guideKind : 'allDone'} look={cardLook} onAction={() => onGuide(home.mode === 'guide' ? home.guideKind : 'allDone')} />;

  return <div ref={stage} className="home-stage">
    {body}
    {dialog?.kind === 'short' && <TimeboxShort data={{ cardId: dialog.cardId, remainingMinutes: dialog.remaining, at: dialog.at }} dismiss={() => setDialog(null)}
      resolve={r => setDialog(r.choice === 'stop' ? { kind: 'complete', cardId: dialog.cardId, at: r.at } : null)} />}
    {dialog?.kind === 'complete' && <CompleteDialog at={dialog.at} isShrinkCard={!!full?.shrunk_from} onCancel={() => setDialog(null)}
      onConfirm={r => { setDialog(null); void act(() => actions.complete(dialog.cardId, r.at, r.note, r.continueCard)); }} />}
    {dialog?.kind === 'shrink' && full && <ShrinkDialog original={full.content} type={full.type} timeboxMinutes={full.timebox_minutes}
      level={full.shrink_level} maxLevel={look.shrinkMaxLevel} defaultTimebox={look.timeboxDefault} onCancel={() => setDialog(null)}
      onConfirm={r => { setDialog(null); void act(() => actions.shrink(dialog.cardId, { content: r.content, type: r.type, minutes: r.timeboxMinutes }, r.at)); }} />}
  </div>;
}
