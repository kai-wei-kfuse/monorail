import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { ActionButton } from '../../ui/controls/Button';
import { Button } from '../../ui/controls/Button';
import { ProjectPicker } from '../../ui/controls/ProjectPicker';
import type { ProjectOption } from '../../ui/controls/ProjectPicker';
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
import { decode } from '../../ui/effects/decode';
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
 * draft：卡头〔插入事件〕刚点下、还没写名字（用户 2026-11-06 确认的流程）。插入卡马上落下，标题位置是空输入框、光标在里面，计时从点下那一刻起；
 * 「记到」可选项目（缺省「未分类」）；回车交给 onSubmit 记下（之后同一张插入卡接着计，不再落下）；Esc 或〔回到任务〕撤回，什么都不记。
 */
export function InsertCard({ insert, now, look, titleScale, place, onBack, onEndOriginal, onPause, onContinue, exiting = false, onExited, draft, mirror, children }:
  { insert: Insert; now: number; look: CardLook; titleScale: number; place: 'bottom' | 'top';
    /** 插入已经结束（不是在这张卡上点的，例如快捷活动再点一次、底栏、小窗）：演完收走再交给 onExited 拿掉（用户 2026-11-06） */
    exiting?: boolean; onExited?: () => void;
    /** 还没写名字的插入（只在界面上，没写盘）。onSubmit 交回 false 表示没记上（输入框留着，可以再试或 Esc） */
    draft?: {
      projects: ProjectOption[];
      text?: string;
      onChangeText?: (text: string) => void;
      project?: string;
      onChangeProject?: (project: string) => void;
      busy?: boolean;
      onSubmit: (value: { description: string; project: string }) => Promise<boolean>;
      onCreateProject?: (name: string) => void;
    };
    /** 另一窗口（小窗）正在输入插入草稿时的只读镜像（ADR 0024）：只显示说明与撤回，不冒充已持久插入 */
    mirror?: { ownerLabel: string; busy?: boolean };
    /** 交回 false 表示没成功（插入卡复位） */ onBack: () => Promise<unknown>; onEndOriginal: () => Promise<unknown>; onPause: () => void; onContinue: () => void; children: ReactNode }) {
  const stack = useRef<HTMLDivElement>(null), topRef = useRef<HTMLElement>(null), [asking, setAsking] = useState(false), [leaving, setLeaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null), [localName, setLocalName] = useState(''), [localProject, setLocalProject] = useState('未分类'), [saving, setSaving] = useState(false);
  const name = draft?.text !== undefined ? draft.text : localName;
  const setName = (v: string) => { if (draft?.onChangeText) draft.onChangeText(v); else setLocalName(v); };
  const project = draft?.project !== undefined ? draft.project : localProject;
  const setProject = (v: string) => { if (draft?.onChangeProject) draft.onChangeProject(v); else setLocalProject(v); };
  const isBusy = saving || Boolean(draft?.busy) || Boolean(mirror?.busy);
  const isUncommitted = Boolean(draft || mirror);
  /** 正在演 / 演过的收走动画（在这张卡上点的〔回到任务〕）：插入在提交后结束时等它们演完再拿掉 */
  const leaveAnims = useRef<Animation[] | null>(null);
  const o = insert.over, onTask = o.kind === 'card';
  // 读数是这件插入的事一共计了多久：前面几段 + 开着的这一段；暂停时停在前面几段之和，不归零（用户 2026-11-06）
  const elapsed = (insert.closedMs ?? 0) + (insert.startedAt ? Math.max(0, now - Date.parse(insert.startedAt)) : 0);
  const progress = cardProgress(elapsed, null, !insert.paused, insert.paused);
  const ts = Math.max(26, Math.floor(80 * titleScale / 100));

  // 插入时：原来那张退后，插入卡落下，顶边闪一下（只在第一次出现时演）
  useEffect(() => {
    // 底下那张在 UnderCard 的 display:contents 那一层里（不是 .ins-stack 的直接子元素）；按「不是插入卡的那张卡」找，不依赖 ins-under 先挂上
    const s = stack.current, t = topRef.current, under = s?.querySelector<HTMLElement>('.card:not(.ins-top)');
    if (!s || !t || !under) return;
    if (motionLevel() === 'reduced') { t.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'linear', fill: 'backwards' }); return; }
    s.classList.add('clip');
    const back = play(under, [{ transform: 'none' }, { transform: 'translateY(var(--sink)) scale(var(--scale))' }], { duration: 280, ease: 'snap' });
    const drop = play(t, [{ transform: 'translateY(calc(-100% - 90px))', opacity: 0 }, { offset: .2, opacity: 1 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 340, delay: 120, ease: 'snap' });
    void settled([back, drop]).then(() => {
      s.classList.remove('clip');
      play(t.querySelector('.ins-stripe'), [{ transform: 'scaleY(1)' }, { transform: 'scaleY(3)', offset: .3 }, { transform: 'scaleY(1)' }], { duration: 380, easing: 'ease-out' });
      // 竖条「INSERT」解码（§11.14 动画）
      decode(t.querySelector('.vt-t'));
    });
  }, []);

  // 鼠标放在〔回到任务〕上：插入卡往上抬 14px，像要被推回去（只在「完整」时）
  const lift = (on: boolean) => {
    const t = topRef.current;
    if (!t || leaving || motionLevel() !== 'full') return;
    t.animate([{ transform: on ? 'translateY(0)' : 'translateY(-14px)' }, { transform: on ? 'translateY(-14px)' : 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
  };
  /** 收走：插入卡往上收走，原来那张回到前面、颜色恢复、上沿那条收起。交回这几段动画（失败时撤掉用） */
  const playLeave = (): Animation[] => {
    const s = stack.current, t = topRef.current, under = s?.querySelector<HTMLElement>('.card:not(.ins-top)'), anims: Animation[] = [];
    if (s && t && under && motionLevel() === 'full') {
      s.classList.add('clip');
      const from = getComputedStyle(t).transform;
      anims.push(t.animate([{ transform: from === 'none' ? 'translateY(0)' : from, opacity: 1 }, { offset: .6, opacity: 1 }, { transform: 'translateY(calc(-100% - 90px))', opacity: 0 }],
        { duration: 280, easing: 'cubic-bezier(.6,0,.9,.4)', fill: 'forwards' }));
      anims.push(under.animate([{ transform: 'translateY(var(--sink)) scale(var(--scale))' }, { transform: 'none' }], { duration: 280, delay: 60, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' }));
      under.querySelectorAll<HTMLElement>(':scope > .card-in, :scope > .vtab, :scope > .topo').forEach(el =>
        anims.push(el.animate([{ opacity: 'var(--dim)', filter: 'grayscale(1)' }, { opacity: 1, filter: 'grayscale(0)' }], { duration: 280, delay: 60, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' })));
      const peek = s.querySelector<HTMLElement>('.ins-peek');
      if (peek) anims.push(peek.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'linear', fill: 'forwards' }));
    } else if (t && motionLevel() === 'reduced') anims.push(t.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'linear', fill: 'forwards' }));
    if (anims.length) leaveAnims.current = anims;
    return anims;
  };
  // 插入在别处结束了：没演过收走就补演，演完再拿掉
  useEffect(() => {
    if (!exiting) return;
    const anims = leaveAnims.current ?? playLeave();
    if (!anims.length) { onExited?.(); return; }
    void settled(anims).then(() => onExited?.());
  }, [exiting]);

  // 回到任务：点下去就提交（不等动画），同时演出——插入卡往上收走，原来那张回到前面、颜色恢复、上沿那条收起。
  // 写盘通常比动画慢（真窗口量到 0.8–1 秒），先演再提交会在动画后停一段（用户 2026-11-06）；两件事一起做，提交一到就换成正常的卡
  const back = async () => {
    if (leaving || exiting || isBusy) return;
    setLeaving(true);
    const commit = onBack();
    const anims = playLeave();
    try {
      const ok = await commit;
      // 没有成功（状态变了、写盘出错）：撤掉收走的动画，插入卡和底下那张复位（G7 审核 S4）
      if (ok === false) { anims.forEach(a => a.cancel()); leaveAnims.current = null; stack.current?.classList.remove('clip'); }
    } finally { setLeaving(false); }
  };
  const end = async () => { setAsking(false); setLeaving(true); try { await onEndOriginal(); } finally { setLeaving(false); } };
  // 还没写名字：一出现光标就在标题位置（落下动画同时进行）
  useEffect(() => { if (draft) nameRef.current?.focus({ preventScroll: true }); }, [Boolean(draft)]);
  /** 回车记下：没写字不动；输入法还在选字时的回车不算 */
  const submit = async () => {
    const description = name.trim();
    if (!draft || !description || isBusy || leaving || exiting) return;
    setSaving(true);
    try { if (!await draft.onSubmit({ description, project })) nameRef.current?.focus({ preventScroll: true }); }
    finally { setSaving(false); }
  };
  const nameKeys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); void submit(); }
    else if (e.key === 'Escape') { e.preventDefault(); void back(); }
  };

  const where = <span className="ins-where">插在「<b>{short(o.title)}</b>」中间</span>;
  return <div className="ins-stack" ref={stack}>
    {/* 原来那张：挂上「退后」样式，上沿露出的一条整条可点 */}
    <UnderCard over={o} onBack={() => void back()}>{children}</UnderCard>
    <CardFrame look={look} running={!insert.paused} slotNo="插" slotLabel="INSERT" cardRef={topRef} className="ins-top" data={{ up: place, drift: '' }}
      fx={<>
        <i className="ins-stripe" aria-hidden="true" />
        <div className="ins-up" role="group" aria-label="回去">
          <button type="button" className="ins-up-back" aria-label={onTask ? '回到任务' : '回到原来的事'} title={onTask ? `回到「${plainText(o.title)}」，接着计` : `回到「${plainText(o.title)}」`}
            onPointerEnter={() => lift(true)} onPointerLeave={() => lift(false)} onClick={() => void back()} disabled={leaving || isBusy}>
            <span className="ins-arrow"><svg viewBox="0 0 40 48" aria-hidden="true"><path d="M20 3 37 21H27v24H13V21H3z" /></svg></span>
            <span className="ins-up-x"><span className="ins-up-t"><b className="ins-up-cn">{onTask ? '回到任务' : '回到原来的事'}</b><i className="ins-up-en">{onTask ? 'BACK TO QUEST' : 'BACK'}</i></span>
              <span className="ins-up-s">{short(o.title)} · <b>{todayText(o)}</b></span></span>
          </button>
          {/* 还没写名字时没有插入的那一条可以接着计，不给〔结束原任务〕 */}
          {!isUncommitted && <button type="button" className="ins-up-end" aria-label={`结束「${plainText(o.title)}」。${onTask ? '若未完成，则重新放入背包' : '这条自由记录到此为止'}`}
            onClick={() => setAsking(true)} disabled={leaving}>
            <i className="ins-end-bg" aria-hidden="true" /><span className="ins-end-k">{onTask ? '结束原任务' : '结束原来的事'}</span>
          </button>}
        </div>
      </>}>
      <div className="c-head">
        <span className="ins-badge" /><b>插入</b>
        {draft
          ? <span className="c-meta c-picks">记到
              <ProjectPicker flat id="ins-project" value={project} options={draft.projects}
                onChange={p => { setProject(p); queueMicrotask(() => nameRef.current?.focus({ preventScroll: true })); }}
                onCreate={draft.onCreateProject} disabled={isBusy} />
            </span>
          : mirror
            ? <span className="c-meta c-picks">小窗正在输入</span>
            : <span className="c-meta c-picks">记到 {insert.project}</span>}
        <span className="c-corner">{where}</span>
      </div>
      <div className="hero">
        <Corners>{draft
          ? <div className="f-input" style={{ '--ts': `${ts}px` } as CSSProperties}>
              <input ref={nameRef} id="ins-what" className="f-title" aria-label="插入的事" autoComplete="off" placeholder="在做什么？写好回车"
                value={name} onChange={e => setName(e.target.value)} onKeyDown={nameKeys} readOnly={isBusy} />
            </div>
          : mirror
            ? <h1 className="title" style={{ '--ts': `${ts}px` } as CSSProperties}><span className="ph">{mirror.ownerLabel}</span></h1>
            : <h1 className="title" style={{ '--ts': `${ts}px` } as CSSProperties}><MarkedText content={insert.name || '（没有名字）'} /></h1>}</Corners>
        <p className="f-sub">{insert.startedAt && <>开始于 <b>{new Date(insert.startedAt).toTimeString().slice(0, 5)}</b></>}
          <span>{draft ? '回车记下；Esc 或〔回到任务〕撤回，这段不记' : mirror ? '正在小窗写插入事件；点上方或下方返回可撤回草稿，这段不记' : `这一段不算进「${short(o.title)}」`}</span></p>
      </div>
      <VBars filled={progress.filled} state={progress.state} />
      <div className="foot">
        <ActivityActions className="actions">{isUncommitted ? null : insert.paused
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
