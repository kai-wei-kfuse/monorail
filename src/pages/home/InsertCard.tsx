import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ActionButton } from '../../ui/controls/Button';
import { Button } from '../../ui/controls/Button';
import { Dialog } from '../../ui/overlay/Dialog';
import { Icon } from '../../ui/icons/Icon';
import { MiniBars, VBars } from '../../ui/marks/VBars';
import { Readout } from '../../ui/marks/Readout';
import { Corners } from '../../ui/marks/Corners';
import { MarkedText, plainText } from '../../ui/marks/MarkedText';
import { formatReadout } from '../../shared/duration';
import type { HomeSlice } from '../../store/homeSlice';
import { cardProgress } from '../../widgets/cardProgress';
import { motionLevel, play, settled } from '../../ui/effects/animate';
import type { CardLook } from './CardFrame';
import { CardFrame } from './CardFrame';
import { ActivityActions } from './ActivityActions';
import './insert.css';

type Insert = NonNullable<HomeSlice['insert']>;
const short = (s: string) => { const t = plainText(s); return t.length > 14 ? t.slice(0, 13) + '…' : t; };
const clock = (ms: number) => formatReadout(Math.max(0, ms), 'mmss');
const todayText = (o: Insert['over']) => o.kind === 'card'
  ? `${clock(o.todayMs)}${o.todayGoal !== null ? ` / ${o.todayGoal}:00` : ''}` : clock(o.elapsedMs);

/**
 * 插入卡（ADR 0021 第 3 条，UI 规范 §11.14，原型 insert-prototype.html v0.24 定稿）。
 * children 是原来那张卡（任务卡或自由记录卡），退到后面、上沿露出一条，点它 =〔回到任务〕。
 * 插入卡盖在上面：读数走插入这一段；按钮只有〔暂停〕/〔继续〕；回去区域左边〔回到任务〕、右边〔结束原任务〕（先确认）。
 * place 是设置 06「插入卡的回去区域」：bottom / top。动效「完整」：落下、抬起、回去收走；「简化」淡入淡出；「关闭」直接切换。
 */
export function InsertCard({ insert, now, look, titleScale, place, onBack, onEndOriginal, onPause, onContinue, children }:
  { insert: Insert; now: number; look: CardLook; titleScale: number; place: 'bottom' | 'top';
    /** 交回 false 表示没成功（插入卡复位） */ onBack: () => Promise<unknown>; onEndOriginal: () => Promise<unknown>; onPause: () => void; onContinue: () => void; children: ReactNode }) {
  const stack = useRef<HTMLDivElement>(null), topRef = useRef<HTMLElement>(null), [asking, setAsking] = useState(false), [leaving, setLeaving] = useState(false);
  const o = insert.over, onTask = o.kind === 'card';
  const elapsed = insert.startedAt ? now - Date.parse(insert.startedAt) : 0;
  const progress = cardProgress(elapsed, null, !insert.paused, insert.paused);
  const ts = Math.max(26, Math.floor(80 * titleScale / 100));

  // 插入时：原来那张退后，插入卡落下，顶边闪一下（只在第一次出现时演）
  useEffect(() => {
    const s = stack.current, t = topRef.current, under = s?.querySelector<HTMLElement>(':scope > .card:not(.ins-top)');
    if (!s || !t || !under) return;
    if (motionLevel() === 'reduced') { t.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'linear', fill: 'backwards' }); return; }
    s.classList.add('clip');
    const back = play(under, [{ transform: 'none' }, { transform: 'translateY(var(--sink)) scale(var(--scale))' }], { duration: 280, ease: 'snap' });
    const drop = play(t, [{ transform: 'translateY(calc(-100% - 90px))', opacity: 0 }, { offset: .2, opacity: 1 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 340, delay: 120, ease: 'snap' });
    void settled([back, drop]).then(() => {
      s.classList.remove('clip');
      play(t.querySelector('.ins-stripe'), [{ transform: 'scaleY(1)' }, { transform: 'scaleY(3)', offset: .3 }, { transform: 'scaleY(1)' }], { duration: 380, easing: 'ease-out' });
    });
  }, []);

  // 鼠标放在〔回到任务〕上：插入卡往上抬 14px，像要被推回去（只在「完整」时）
  const lift = (on: boolean) => {
    const t = topRef.current;
    if (!t || leaving || motionLevel() !== 'full') return;
    t.animate([{ transform: on ? 'translateY(0)' : 'translateY(-14px)' }, { transform: on ? 'translateY(-14px)' : 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
  };
  // 回到任务：插入卡往上收走，原来那张回到前面，然后交给服务端（数据在提交后才变，这里只演出）
  const back = async () => {
    if (leaving) return;
    setLeaving(true);
    const s = stack.current, t = topRef.current, under = s?.querySelector<HTMLElement>(':scope > .card:not(.ins-top)');
    if (s && t && under && motionLevel() === 'full') {
      s.classList.add('clip');
      const from = getComputedStyle(t).transform;
      const out = t.animate([{ transform: from === 'none' ? 'translateY(0)' : from, opacity: 1 }, { offset: .6, opacity: 1 }, { transform: 'translateY(calc(-100% - 90px))', opacity: 0 }],
        { duration: 280, easing: 'cubic-bezier(.6,0,.9,.4)', fill: 'forwards' });
      const fwd = under.animate([{ transform: 'translateY(var(--sink)) scale(var(--scale))' }, { transform: 'none' }], { duration: 280, delay: 100, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' });
      await settled([out, fwd]);
    } else if (t && motionLevel() === 'reduced') await settled([t.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'linear', fill: 'forwards' })]);
    try {
      const ok = await onBack();
      // 没有成功（状态变了、写盘出错）：撤掉收走的动画，插入卡和底下那张复位（G7 审核 S4）
      if (ok === false) [t, under].forEach(el => el?.getAnimations().forEach(a => a.cancel()));
      s?.classList.remove('clip');
    } finally { setLeaving(false); }
  };
  const end = async () => { setAsking(false); setLeaving(true); try { await onEndOriginal(); } finally { setLeaving(false); } };

  const where = <span className="ins-where">插在「<b>{short(o.title)}</b>」中间</span>;
  return <div className="ins-stack" ref={stack}>
    {/* 原来那张：挂上「退后」样式，上沿露出的一条整条可点 */}
    <UnderCard over={o} onBack={() => void back()}>{children}</UnderCard>
    <CardFrame look={look} running={!insert.paused} slotNo="插" slotLabel="INSERT" cardRef={topRef} className="ins-top" data={{ up: place, drift: '' }}
      fx={<>
        <i className="ins-stripe" aria-hidden="true" />
        <div className="ins-up" role="group" aria-label="回去">
          <button type="button" className="ins-up-back" aria-label={onTask ? '回到任务' : '回到原来的事'} title={onTask ? `回到「${plainText(o.title)}」，接着计` : `回到「${plainText(o.title)}」`}
            onPointerEnter={() => lift(true)} onPointerLeave={() => lift(false)} onClick={() => void back()} disabled={leaving}>
            <span className="ins-arrow"><svg viewBox="0 0 40 48" aria-hidden="true"><path d="M20 3 37 21H27v24H13V21H3z" /></svg></span>
            <span className="ins-up-x"><span className="ins-up-t"><b className="ins-up-cn">{onTask ? '回到任务' : '回到原来的事'}</b><i className="ins-up-en">{onTask ? 'BACK TO QUEST' : 'BACK'}</i></span>
              <span className="ins-up-s">{short(o.title)} · <b>{todayText(o)}</b></span></span>
          </button>
          <button type="button" className="ins-up-end" aria-label={`结束「${plainText(o.title)}」。${onTask ? '若未完成，则重新放入背包' : '这条自由记录到此为止'}`}
            onClick={() => setAsking(true)} disabled={leaving}>
            <i className="ins-end-bg" aria-hidden="true" /><span className="ins-end-k">{onTask ? '结束原任务' : '结束原来的事'}</span>
          </button>
        </div>
      </>}>
      <div className="c-head">
        <span className="ins-badge" /><b>插入</b>
        <span className="c-meta c-picks">记到 {insert.project}</span>
        <span className="c-corner">{where}</span>
      </div>
      <div className="hero">
        <Corners><h1 className="title" style={{ '--ts': `${ts}px` } as CSSProperties}><MarkedText content={insert.name || '（没有名字）'} /></h1></Corners>
        <p className="f-sub">{insert.startedAt && <>开始于 <b>{new Date(insert.startedAt).toTimeString().slice(0, 5)}</b></>}<span>这一段不算进「{short(o.title)}」</span></p>
      </div>
      <VBars filled={progress.filled} state={progress.state} />
      <div className="foot">
        <ActivityActions className="actions">{insert.paused
          ? <ActionButton primary cn="继续" en="RESUME" icon="play" disabled={!insert.canContinue || leaving} title={insert.canContinue ? `继续「${plainText(insert.name)}」` : '找不到前一段，没法接着继续'} onClick={onContinue} />
          : <ActionButton cn="暂停" en="PAUSE" icon="pause" disabled={leaving} onClick={onPause} />}</ActivityActions>
        <Readout state={progress.state} en="INSERT" cn="插入计时" stateCn={insert.paused ? '已暂停 · 还在等你回去' : '插入中'} stateEn={insert.paused ? 'PAUSED' : 'INSERTING'}
          digits={clock(elapsed)} />
      </div>
    </CardFrame>
    {asking && <Dialog en={onTask ? 'END QUEST' : 'END'} title={`结束「${plainText(o.title)}」？`} onClose={() => setAsking(false)}
      footer={<><Button onClick={() => setAsking(false)}>取消</Button><Button tone="ink" autoFocus onClick={() => void end()}>结束</Button></>}>
      <p className="ins-note">{onTask ? '若未完成，则重新放入背包。' : '这条自由记录到此为止，插入的事接着计。'}</p>
    </Dialog>}
  </div>;
}

/** 原来那张卡退到后面：给它的外层 .card 挂上 ins-under，上沿加一条可点的露出条。 */
function UnderCard({ over, onBack, children }: { over: Insert['over']; onBack: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const card = ref.current?.querySelector<HTMLElement>(':scope > .card');
    card?.classList.add('ins-under');
    return () => card?.classList.remove('ins-under');
  });
  const onTask = over.kind === 'card', goal = onTask ? over.todayGoal : null;
  const filled = onTask && goal ? (over.todayMs / 60_000) / goal * 30 : 0;
  return <div ref={ref} style={{ display: 'contents' }}>
    {children}
    <button type="button" className="ins-peek" title="回到这里" onClick={onBack}>
      <i className="mk" /><span className="pk-t">{onTask ? `${over.track}任务 · ` : '自由记录 · '}{plainText(over.title)}</span>
      <span className="pk-s"><em>PAUSED</em>暂停 · 等你回来</span>
      <MiniBars filled={filled} />
      <b className="pk-n">{todayText(over)}</b>
      <span className="pk-go"><Icon name="back" /><span>{onTask ? '回到任务' : '回到这件事'}</span></span>
    </button>
  </div>;
}
