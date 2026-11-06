import { useEffect, useRef, useState } from 'react';
import { motionLevel } from '../../../ui/effects/animate';
import { plainText } from '../../../ui/marks/MarkedText';
import './flip.css';

export interface FlipCard { id: string; title: string; track: '主线' | '支线'; taskName: string | null; todayMinutes: number | null; high: boolean }

const EASE = { ease: 'cubic-bezier(.2,.8,.2,1)', snap: 'cubic-bezier(.7,0,.2,1)', overshoot: 'cubic-bezier(.2,1.3,.35,1)' };
const shuffle = <T,>(list: T[]) => list.map(v => [Math.random(), v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

/**
 * 翻卡（已定 51、52，UI 规范 §11.15）：板子上没达成的几项（最多 6 张）背面朝上，从〔抽一张〕飞出来摊成一排（420ms，每张错开 55ms），
 * 往中间收拢再散开洗一下（520ms snap），抽中的那张抬起、移到中间、放大 1.35 倍翻面，其余往下收走。**不写概率**。
 * 卡下面「今天就做这个」〔换一张〕〔开始〕。动效「关闭」时不翻，直接开始（调用方处理）；「简化」只淡入翻好的那一张。
 * from：〔抽一张〕按钮或底栏〔背包〕的位置，卡从那里飞出来；没有就从下面。
 */
export function FlipDeal({ pick, pool, from, onStart, onAgain, onCancel }:
  { pick: FlipCard; pool: FlipCard[]; from: DOMRect | null; onStart: () => void; onAgain: () => void; onCancel: () => void }) {
  const host = useRef<HTMLDivElement>(null), [ready, setReady] = useState(false), [on, setOn] = useState(false);
  const [shown] = useState(() => shuffle([pick, ...shuffle(pool.filter(c => c.id !== pick.id)).slice(0, 5)]));

  useEffect(() => {
    const h = host.current;
    if (!h) return;
    const cards = [...h.querySelectorAll<HTMLElement>('.fd-card')], win = cards[shown.findIndex(c => c.id === pick.id)];
    const sr = h.getBoundingClientRect(), n = cards.length, gap = Math.min(166, (sr.width - 200) / Math.max(1, n - 1)), x0 = -(n - 1) * gap / 2;
    const fx = from ? from.left + from.width / 2 - (sr.left + sr.width / 2) : 0, fy = from ? from.top + from.height / 2 - (sr.top + sr.height * .46) : sr.height / 2;
    const xs = cards.map((_, i) => x0 + i * gap), rot = (i: number) => (i - (n - 1) / 2) * 2.5;
    let alive = true;
    requestAnimationFrame(() => setOn(true));
    void (async () => {
      if (motionLevel() !== 'full') {
        cards.forEach(c => { if (c !== win) c.style.opacity = '0'; });
        win.classList.add('open', 'pick'); win.style.transform = 'translate(0, -24px) scale(1.35)';
        win.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'linear', fill: 'backwards' });
        setReady(true); return;
      }
      // 1. 发牌：从〔抽一张〕飞出来，摊成一排
      await Promise.all(cards.map((c, i) => c.animate([
        { transform: `translate(${fx}px, ${fy}px) scale(.25) rotate(${-20 + i * 7}deg)`, opacity: 0 },
        { transform: `translate(${xs[i]}px, 0) rotate(${rot(i)}deg)`, opacity: 1 }], { duration: 420, delay: i * 55, easing: EASE.ease, fill: 'forwards' }).finished));
      if (!alive) return;
      // 2. 洗一下：往中间收拢再散开
      if (n > 1) await Promise.all(cards.map((c, i) => c.animate([
        { transform: `translate(${xs[i]}px, 0) rotate(${rot(i)}deg)` },
        { transform: `translate(${(i - (n - 1) / 2) * 8}px, -6px) rotate(${i % 2 ? 4 : -4}deg)`, offset: .5 },
        { transform: `translate(${xs[i]}px, 0) rotate(${rot(i)}deg)` }], { duration: 520, easing: EASE.snap, fill: 'forwards' }).finished));
      if (!alive) return;
      // 3. 抽中的那张抬起、移到中间、翻面；其他的往下收走
      cards.forEach((c, i) => { if (c !== win) c.animate([{ transform: `translate(${xs[i]}px, 0)`, opacity: 1 }, { transform: `translate(${xs[i] * .6}px, 120px) scale(.8)`, opacity: 0 }],
        { duration: 300, delay: i * 30, easing: EASE.snap, fill: 'forwards' }); });
      const wi = cards.indexOf(win);
      win.classList.add('pick');
      await win.animate([{ transform: `perspective(900px) translate(${xs[wi]}px, 0) rotateY(0deg)` }, { transform: 'perspective(900px) translate(0, -24px) scale(1.25) rotateY(90deg)' }],
        { duration: 320, easing: 'cubic-bezier(.5,0,1,.6)', fill: 'forwards' }).finished;
      win.classList.add('open');
      await win.animate([{ transform: 'perspective(900px) translate(0, -24px) scale(1.25) rotateY(-90deg)' }, { transform: 'perspective(900px) translate(0, -24px) scale(1.35) rotateY(0deg)' }],
        { duration: 360, easing: EASE.overshoot, fill: 'forwards' }).finished;
      if (alive) setReady(true);
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); } };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onCancel]);

  return <div ref={host} className={`fd-deal${on ? ' on' : ''}`} role="dialog" aria-label="抽一张" onPointerDown={e => { if (e.target === e.currentTarget && ready) onCancel(); }}>
    {shown.map(c => <div key={c.id} className={`fd-card${c.track === '主线' ? ' main' : ''}`}>
      <div className="back" />
      <div className="face"><span className="chip2">{c.track}</span><b>{plainText(c.title)}</b>
        <small>{c.taskName ?? ''}{c.todayMinutes ? `${c.taskName ? ' · ' : ''}今天 ${c.todayMinutes} 分钟` : ''}</small>
        {c.high && <span className="pri">优先 高</span>}</div>
    </div>)}
    <div className={`fd-cap${ready ? ' on' : ''}`} aria-hidden={!ready}>
      <div>今天就做这个</div>
      <div><button type="button" disabled={!ready} onClick={onAgain}>换一张</button><button type="button" className="go" disabled={!ready} autoFocus onClick={onStart}>开始</button></div>
    </div>
  </div>;
}
