import { useEffect, useRef, useState } from 'react';
import { Frame, StatusBar } from '../../ui/frame/StatusBar';
import { TitleBar } from '../../ui/frame/TitleBar';
import { WindowButtons } from '../../ui/frame/WindowButtons';
import { Wipe } from '../../ui/effects/Wipe';
import { cardProgress } from '../../widgets/cardProgress';
import { TaskCard } from '../../pages/home/TaskCard';
import type { TaskCardView } from '../../pages/home/TaskCard';
import { CardActions } from '../../pages/home/CardActions';
import { GuideCard } from '../../pages/home/GuideCard';
import { RestCard } from '../../pages/home/RestCard';
import { ReviewCard } from '../../pages/home/ReviewCard';
import { playAfterWipe, playColdIntro } from '../../pages/home/intro';
import { QuickActs } from '../shell/QuickActs';
import { BaselineMarks } from '../shell/BaselineMarks';
import { MiniPreview } from './MiniPreview';
import { QuickBar } from '../../pages/quickbar/QuickBar';
import { CompleteDialog } from '../../pages/home/CompleteDialog';
import { ShrinkDialog } from '../../pages/home/ShrinkDialog';
import { NoticeHost } from '../shell/NoticeHost';
import { StatusBlock } from '../shell/StatusBlock';
import type { Notice } from '../../widgets/notices/types';

export const PREVIEW_PAGES = ['card', 'over', 'guide', 'rest', 'review', 'mini', 'quickbar'];
const look = { topoMode: 'dynamic' as const, topoDepth: 60, paused: false };
const TABS = [{ id: 'home', cn: '首页', en: 'HOME' }, { id: 'backpack', cn: '背包', en: 'BACKPACK' }, { id: 'review', cn: '回顾', en: 'REVIEW' }, { id: 'settings', cn: '设置', en: 'SETTINGS' }];
const min = (m: number) => m * 60_000;
const ACTS = [{ id: 'qa-wc', name: '厕所' }, { id: 'qa-parcel', name: '拿快递' }, { id: 'qa-video', name: '刷视频' }];
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
function notices(o: string | null): Notice[] {
  const toasts: Notice[] = [
    { id: 't1', kind: 'longActivity', data: { activity: '沿 Python 往下学', startedAt: iso(min(240)), hours: 4 } },
    { id: 't2', kind: 'skipSignal', data: { cardId: 'c', title: '改完整份简历', count: 3 } },
    { id: 't3', kind: 'subconscious', data: { answer: '刷视频', count: 3 } },
    { id: 't4', kind: 'inputHint', data: {} },
  ];
  const dialogs: Record<string, Notice> = {
    offlineAsk: { id: 'd1', kind: 'offlineAsk', data: { from: iso(min(130)), to: iso(min(5)), activities: ACTS } },
    backfill: { id: 'd2', kind: 'backfill', data: { activities: ACTS, now: iso(0) } },
    timeboxShort: { id: 'd3', kind: 'timeboxShort', data: { cardId: 'c', remainingMinutes: 15, at: iso(0) } },
    restReturn: { id: 'd4', kind: 'restReturn', data: { suggestion: '眺望窗外' } },
  };
  return o === 'toasts' ? toasts : o && dialogs[o] ? [dialogs[o]] : [];
}

function sample(page: string): TaskCardView {
  const elapsedMs = page === 'over' ? min(66) + 14_000 : min(47) + 12_000, goalMinutes = 60;
  return { id: 'c1', slotNo: '01', slotOf: '/03', task: '找工作', type: '时间盒卡', goalMinutes, content: '沿 [Python] 往下学 1 小时',
    progressNote: page === 'over' ? '看完了装饰器，下一步写几个小练习' : undefined, elapsedMs, progress: cardProgress(elapsedMs, goalMinutes, true) };
}

/** 首页部件预览（只在开发时用）。双击卡片播一次「再抽一张」擦除，双击标题是改内容；?o= 叠一层对话框或提示。 */
export function HomePreview({ page, overlay }: { page: string; overlay: string | null }) {
  const stage = useRef<HTMLDivElement>(null), app = useRef<HTMLDivElement>(null);
  const [wipe, setWipe] = useState(false), [content, setContent] = useState<string | null>(null);
  const view = { ...sample(page), ...(content === null ? {} : { content }) };
  useEffect(() => { if (stage.current && app.current) return playColdIntro(app.current, stage.current, stage.current.querySelector('.digits')); }, []);
  if (page === 'quickbar') return <div style={{ padding: 40, background: '#3a3a3c', height: '100%' }}><div style={{ width: 760 }}><QuickBar tasks={[{ id: 'p1', name: '找工作' }]} onSave={async () => {}} onHide={() => {}} /></div></div>;
  if (page === 'mini') return <div style={{ padding: 40, background: '#3a3a3c', height: '100%' }}><MiniPreview /></div>;
  const title = <TitleBar name="单轨" tabs={TABS} active="home" onTab={() => {}}>
    <StatusBlock kind={page === 'rest' ? 'away' : 'focus'} label={page === 'rest' ? '休息' : '沿 Python 往下学'} startedAt={new Date(Date.now() - view.elapsedMs).toISOString()} onClick={() => {}} />
    <WindowButtons pinned={false} maximized={false} onPin={() => {}} onMinimize={() => {}} onMaximize={() => {}} onClose={() => {}} />
  </TitleBar>;
  const dock = <StatusBar left={<QuickActs acts={[{ id: 'wc', name: '厕所', icon: 'wc' }, { id: 'p', name: '拿快递', icon: 'parcel' }]} current={null} onPick={() => {}} onSleep={() => {}} onTemp={() => {}} />}
    right={<BaselineMarks main side={false} />} />;
  return <div ref={app} style={{ height: '100%' }}><Frame titleBar={title} statusBar={dock}>
    <div ref={stage} style={{ display: 'grid', minHeight: 0 }} onDoubleClick={e => { if (!(e.target as HTMLElement).closest('.title, .title-edit')) setWipe(true); }}>
      {(page === 'card' || page === 'over') && <TaskCard view={view} look={look} titleScale={65} onEditContent={(_, text) => setContent(text)}
        corner={<span className="c-hint">还没有主线</span>}
        actions={<CardActions running shrink={page === 'over' ? 'max' : 'ok'} onStart={() => {}} onComplete={() => {}} onShrink={() => {}} onRedraw={() => {}} />}
        fx={wipe && <Wipe no="支" meta="支线 · 结果卡" title="查一下几台服务器有没有被攻击" onCovered={() => {}} onDone={() => { setWipe(false); playAfterWipe(stage.current!); }} />} />}
      {page === 'guide' && <GuideCard kind="setMain" look={look} onAction={() => {}} />}
      {page === 'rest' && <RestCard suggestion="眺望窗外" look={look} onBack={() => {}} onAddRest={() => {}} />}
      {page === 'review' && <ReviewCard period="2026-W44" resumeStep="擂台对决" betDue look={look} onOpen={() => {}} />}
    </div>
  </Frame>
  <NoticeHost notices={notices(overlay)} onResolve={(n, r) => console.log(n.kind, r)} onDismiss={() => {}} />
  {overlay === 'complete' && <CompleteDialog at={iso(0)} isShrinkCard={false} onConfirm={() => {}} onCancel={() => {}} />}
  {overlay === 'shrink' && <ShrinkDialog original={view.content} type={view.type} timeboxMinutes={60} level={0} maxLevel={2} defaultTimebox={60} onConfirm={() => {}} onCancel={() => {}} />}
  </div>;
}
