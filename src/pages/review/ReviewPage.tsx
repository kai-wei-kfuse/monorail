import { useState } from 'react';
import type { ReactNode } from 'react';
import { SideNav, SplitLayout } from '../../ui/layout/SideNav';
import { PanelHeader } from '../../ui/layout/PanelHeader';
import { Button } from '../../ui/controls/Button';
import { Emblem } from '../../ui/marks/Emblem';
import { Arena } from '../../widgets/Arena';
import { ColdPick } from '../../widgets/ColdPick';
import type { SwitchMainDraft } from './SwitchMain';
import { SwitchMain } from './SwitchMain';
import type { ReviewData, ReviewStep } from '../../store/reviewSlice';
export type { ReviewData, ReviewStep } from '../../store/reviewSlice';
import { NewIdeas } from './NewIdeas';
import { BetReview } from './BetReview';
import './review.css';

const STEPS: { id: ReviewStep; cn: string; en: string; desc: string }[] = [
  { id: 'recap', cn: '回看', en: 'RECAP', desc: '这周做了什么。只看，不做决定；可以切换周期和分组，点一下柱子只看那一段。' },
  { id: 'newIdeas', cn: '新想法入池', en: 'NEW IDEAS', desc: '有新想法就加进来，全部进入活跃池。' },
  { id: 'arena', cn: '擂台对决', en: 'ARENA', desc: '池子超出上限时，两两对决，只选左或右，输的进冷库。不限次数，直到回到上限以内。' },
  { id: 'coldPick', cn: '冷库捞取', en: 'COLD STORAGE', desc: '可选。从冷库拿出两个老想法，带回一个、两个或都不要。' },
  { id: 'bet', cn: '主线复盘', en: 'MAINLINE BET', desc: '主线押注到期：继续还是换。' },
];

export interface ReviewActions {
  goto: (step: ReviewStep, at: string) => void;              // 进入某一步（标记前面做完、保存进度）
  addIdea: (text: string, at: string) => void;
  duel: (winnerId: string, loserId: string, at: string) => void;
  takeCold: (ids: string[], at: string) => void;                // 池满时 ColdPick 已经确认过
  skipCold: (at: string) => void;                               // 冷库这一步不捞了；有待决对决时也用它取消
  continueBet: (at: string) => void;
  switchMain: (draft: SwitchMainDraft, at: string) => void;  // 换主线：新建或放回冷藏的项目，旧主线冷藏或放弃；这一步随之做完
  finish: (at: string) => void;
}

/**
 * 每周回顾：先看做了什么，再整理想法池。每一步做完就保存，中途关掉下次从记下的那一步接着做。
 * 左侧是步骤导航：做过的步骤可以回去看；还没到的不能跳。不需要的步骤（没到押注期的主线复盘）不显示。
 */
export function ReviewPage({ data, actions, parked = [], recap }: { data: ReviewData; actions: ReviewActions; parked?: { id: string; name: string }[];
  /** 第 01 步的回看看板（外面接好查询再传进来） */
  recap: ReactNode }) {
  const [switching, setSwitching] = useState(false);
  const steps = STEPS.filter(s => s.id !== 'bet' || data.betDue);
  const i = steps.findIndex(s => s.id === data.step), cur = steps[i], next = steps[i + 1];
  const at = () => new Date().toISOString();
  const reachable = (id: ReviewStep) => id === data.step || data.done.includes(id);
  const nav = steps.map((s, n) => ({ id: s.id, no: String(n + 1).padStart(2, '0'), cn: s.cn, en: data.done.includes(s.id) ? 'DONE ✓' : s.en }));
  // 擂台：还超上限就不能往下走
  const blocked = cur.id === 'arena' && data.duel !== null;
  // 冷库：池满捞回时 service 发起对决，步骤仍停在冷库，duel 是待决的那一对。
  // 决定之前捞回的那个仍在冷库提议里，用它区分冷库对决和普通的超额配对
  const offeredIds = new Set(data.cold.offered.map(c => c.id));
  const coldDuel = cur.id === 'coldPick' && data.duel && (offeredIds.has(data.duel.left.id) || offeredIds.has(data.duel.right.id)) ? data.duel : null;
  const betMain = data.bet ? data.backpack.inBackpack.find(p => p.slot === '主线' && p.id === data.bet!.taskId) ?? null : null;
  return <>
    <SplitLayout nav={<SideNav en={`REVIEW ${data.period}`} cn="每周回顾" items={nav} active={data.step}
      onSelect={id => { if (reachable(id as ReviewStep)) actions.goto(id as ReviewStep, at()); }}
      foot={<><Emblem /><div><b>回顾</b><span>{data.done.length} / {steps.length} STEPS</span></div></>} />}>
      <PanelHeader no={String(i + 1).padStart(2, '0')} en={cur.en} cn={cur.cn} desc={cur.desc} />
      {cur.id === 'recap' && recap}
      {cur.id === 'newIdeas' && <NewIdeas added={data.addedIdeas} onAdd={actions.addIdea} />}
      {cur.id === 'arena' && (data.duel ? <Arena {...data.duel} onPick={actions.duel} />
        : <p className="ls-empty">想法池在上限以内，不需要对决。</p>)}
      {cur.id === 'coldPick' && (coldDuel ? <Arena {...coldDuel} onPick={actions.duel} />
        : <ColdPick key={data.cold.offered.map(c => c.id).join()} offered={data.cold.offered} poolFree={data.cold.poolFree}
          onTake={actions.takeCold} onSkip={actions.skipCold} />)}
      {coldDuel && <div className="rv-foot">捞回的想法要先赢下这场对决。
        <Button onClick={() => actions.skipCold(at())}>不捞了</Button></div>}
      {cur.id === 'bet' && data.bet && <BetReview {...data.bet} onContinue={actions.continueBet} onSwitch={betMain ? () => setSwitching(true) : undefined} />}
      {cur.id !== 'bet' && !(cur.id === 'coldPick' && (coldDuel || data.cold.offered.length)) && <div className="rv-foot">
        {blocked ? '先把池子压回上限以内。' : '每一步做完就保存，中途关掉下次接着做。'}
        {cur.id === 'coldPick' ? <Button tone="ink" onClick={() => actions.skipCold(at())}>{next ? `下一步：${next.cn}` : '完成回顾'}</Button>
          : next ? <Button tone="ink" disabled={blocked} onClick={() => actions.goto(next.id, at())}>下一步：{next.cn}</Button>
          : <Button tone="ink" disabled={blocked} onClick={() => actions.finish(at())}>完成回顾</Button>}
      </div>}
    </SplitLayout>
    {switching && betMain && <SwitchMain current={betMain} parked={parked}
      onCancel={() => setSwitching(false)} onSave={(draft, a) => { setSwitching(false); actions.switchMain(draft, a); }} />}
  </>;
}

const md = (iso: string) => { const d = new Date(iso); return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };
const hhmm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const WK = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 本期回顾已完成（或还没到回顾日）时的回顾页（原型 mode: 'done'，UI 风格规范 §11.12）：
 * 左侧只有「01 回看 ANYTIME」和一块说明，右侧是提示条加回看看板。回看随时可看，不影响回顾记录。
 */
export function ReviewDonePage({ completedAt, recap }: { completedAt: string | null; recap: ReactNode }) {
  const when = completedAt ? `${md(completedAt)} 周${WK[new Date(completedAt).getDay()]} ${hhmm(completedAt)}` : null;
  return <SplitLayout nav={<SideNav en="REVIEW" cn="每周回顾" items={[{ id: 'recap', no: '01', cn: '回看', en: 'ANYTIME' }]} active="recap" onSelect={() => {}}
    foot={<><Emblem /><div><b>回顾</b><span>DONE</span></div></>} extra={<div className="rv-nav-note"><span className="k">DONE ✓</span>
      {when ? `本期回顾已在 ${when} 完成。` : '这一期还没有要做的回顾。'}回看随时可以打开；下一期到期时，首页会出回顾卡。</div>} />}>
    <PanelHeader no="01" en="RECAP · ANYTIME" cn="回看" desc="随时可看：切换周期和分组看这段时间做了什么；点一下柱子只看那一段。" />
    <div className="rv-banner"><span className="k">REVIEW DONE</span>
      <span>{when ? <>本期回顾已在 <b>{when}</b> 完成。</> : '现在没有进行中的回顾。'}下面的统计随时可以查看，不影响回顾记录。</span></div>
    {recap}
  </SplitLayout>;
}
