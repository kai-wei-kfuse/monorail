import { useState } from 'react';
import { SideNav, SplitLayout } from '../../ui/layout/SideNav';
import { PanelHeader } from '../../ui/layout/PanelHeader';
import { Button } from '../../ui/controls/Button';
import { Emblem } from '../../ui/marks/Emblem';
import type { DuelIdea } from '../../widgets/Arena';
import { Arena } from '../../widgets/Arena';
import type { ColdIdea } from '../../widgets/ColdPick';
import { ColdPick } from '../../widgets/ColdPick';
import type { ProjectDraft, SlotProject } from '../../widgets/ProjectDialog';
import { ProjectDialog } from '../../widgets/ProjectDialog';
import type { RecapData } from './Recap';
import { Recap } from './Recap';
import { NewIdeas } from './NewIdeas';
import { BetReview } from './BetReview';
import './review.css';

export type ReviewStep = 'recap' | 'newIdeas' | 'arena' | 'coldPick' | 'bet';
const STEPS: { id: ReviewStep; cn: string; en: string; desc: string }[] = [
  { id: 'recap', cn: '回看', en: 'RECAP', desc: '这周做了什么。只看，不做决定。' },
  { id: 'newIdeas', cn: '新想法入池', en: 'NEW IDEAS', desc: '有新想法就加进来，全部进入活跃池。' },
  { id: 'arena', cn: '擂台对决', en: 'ARENA', desc: '池子超出上限时，两两对决，只选左或右，输的进冷库。不限次数，直到回到上限以内。' },
  { id: 'coldPick', cn: '冷库捞取', en: 'COLD STORAGE', desc: '可选。从冷库拿出两个老想法，带回一个、两个或都不要。' },
  { id: 'bet', cn: '主线复盘', en: 'MAINLINE BET', desc: '主线押注到期：继续还是换。' },
];

export interface ReviewData {
  period: string;                         // 例如 2026-W44
  step: ReviewStep;                       // 当前做到的步骤，由 service 持久化（附录 A8）
  done: ReviewStep[];                     // 已经做完的步骤
  betDue: boolean;                        // 这一期要不要主线复盘
  recap: RecapData;
  addedIdeas: string[];
  duel: { left: DuelIdea; right: DuelIdea; over: number } | null;   // null：池子在上限以内
  cold: { offered: ColdIdea[]; poolFree: number };
  bet: { project: string; betEndsAt: string; betWeeks: number } | null;
  backpack: { inBackpack: SlotProject[]; sideFree: boolean };
}

export interface ReviewActions {
  goto: (step: ReviewStep, at: string) => void;              // 进入某一步（标记前面做完、保存进度）
  addIdea: (text: string, at: string) => void;
  duel: (winnerId: string, loserId: string, at: string) => void;
  takeCold: (ids: string[], at: string) => void;
  skipCold: (at: string) => void;
  continueBet: (at: string) => void;
  switchMain: (draft: ProjectDraft, at: string) => void;     // 换主线：建或选新主线，旧主线冷藏或放弃；这一步随之做完
  finish: (at: string) => void;
}

/**
 * 每周回顾：先看做了什么，再整理想法池。每一步做完就保存，中途关掉下次从记下的那一步接着做。
 * 左侧是步骤导航：做过的步骤可以回去看；还没到的不能跳。不需要的步骤（没到押注期的主线复盘）不显示。
 */
export function ReviewPage({ data, actions }: { data: ReviewData; actions: ReviewActions }) {
  const [switching, setSwitching] = useState(false);
  const steps = STEPS.filter(s => s.id !== 'bet' || data.betDue);
  const i = steps.findIndex(s => s.id === data.step), cur = steps[i], next = steps[i + 1];
  const at = () => new Date().toISOString();
  const reachable = (id: ReviewStep) => id === data.step || data.done.includes(id);
  const nav = steps.map((s, n) => ({ id: s.id, no: String(n + 1).padStart(2, '0'), cn: s.cn, en: data.done.includes(s.id) ? 'DONE ✓' : s.en }));
  // 擂台：还超上限就不能往下走
  const blocked = cur.id === 'arena' && data.duel !== null;
  return <>
    <SplitLayout nav={<SideNav en={`REVIEW ${data.period}`} cn="每周回顾" items={nav} active={data.step}
      onSelect={id => { if (reachable(id as ReviewStep)) actions.goto(id as ReviewStep, at()); }}
      foot={<><Emblem /><div><b>回顾</b><span>{data.done.length} / {steps.length} STEPS</span></div></>} />}>
      <PanelHeader no={String(i + 1).padStart(2, '0')} en={cur.en} cn={cur.cn} desc={cur.desc} />
      {cur.id === 'recap' && <Recap data={data.recap} />}
      {cur.id === 'newIdeas' && <NewIdeas added={data.addedIdeas} onAdd={actions.addIdea} />}
      {cur.id === 'arena' && (data.duel ? <Arena {...data.duel} onPick={actions.duel} />
        : <p className="ls-empty">想法池在上限以内，不需要对决。</p>)}
      {cur.id === 'coldPick' && <ColdPick key={data.cold.offered.map(c => c.id).join()} offered={data.cold.offered} poolFree={data.cold.poolFree}
        onTake={actions.takeCold} onSkip={a => (next ? actions.goto(next.id, a) : actions.finish(a))} />}
      {cur.id === 'bet' && data.bet && <BetReview {...data.bet} onContinue={actions.continueBet} onSwitch={() => setSwitching(true)} />}
      {cur.id !== 'bet' && <div className="rv-foot">
        {blocked ? '先把池子压回上限以内。' : '每一步做完就保存，中途关掉下次接着做。'}
        {next ? <Button tone="ink" disabled={blocked} onClick={() => actions.goto(next.id, at())}>下一步：{next.cn}</Button>
          : <Button tone="ink" disabled={blocked} onClick={() => actions.finish(at())}>完成回顾</Button>}
      </div>}
    </SplitLayout>
    {switching && <ProjectDialog mode="setMain" inBackpack={data.backpack.inBackpack} mainFree={false} sideFree={data.backpack.sideFree}
      onCancel={() => setSwitching(false)} onSave={(draft, a) => { setSwitching(false); actions.switchMain(draft, a); }} />}
  </>;
}
