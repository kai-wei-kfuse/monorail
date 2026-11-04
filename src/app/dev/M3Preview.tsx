import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { RecapBoard } from '../../pages/review/recap/RecapBoard';
import type { RecapBoardProps } from '../../pages/review/recap/RecapBoard';
import { computeRecap } from '../../domain/review/recap';
import { recapViewStore } from '../../platform/recapView';
import { DEFAULT_RECAP_VIEW } from '../../shared/recap';
import type { RecapViewState } from '../../shared/recap';
import { recapDemo } from './recapDemo';
import { Frame, StatusBar } from '../../ui/frame/StatusBar';
import { TitleBar } from '../../ui/frame/TitleBar';
import { WindowButtons } from '../../ui/frame/WindowButtons';
import type { ReviewActions, ReviewData, ReviewStep } from '../../pages/review/ReviewPage';
import { ReviewDonePage, ReviewPage } from '../../pages/review/ReviewPage';
import { SavedBadge, SettingsPage } from '../../pages/settings/SettingsPage';
import type { Settings } from '../../shared/settings';
import { defaults } from '../../shared/settings';
import { PREVIEW_PROJECTS, PREVIEW_TAGS } from './CalendarPreview';
import { RecentCalls } from '../../widgets/history/RecentCalls';
import { activityDay } from '../../domain/timeline/day';
import { historyDemo } from './HistoryPreview';

const TABS = [{ id: 'home', cn: '首页', en: 'HOME' }, { id: 'backpack', cn: '背包', en: 'BACKPACK' }, { id: 'review', cn: '回顾', en: 'REVIEW' }, { id: 'settings', cn: '设置', en: 'SETTINGS' }];
const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const shell = (active: string, body: ReactElement, right?: ReactElement) => <Frame
  titleBar={<TitleBar name="单轨" tabs={TABS} active={active} onTab={() => {}}>
    <WindowButtons pinned={false} maximized={false} onPin={() => {}} onMinimize={() => {}} onMaximize={() => {}} onClose={() => {}} />
  </TitleBar>}
  statusBar={<StatusBar right={right} />}>{body}</Frame>;

function reviewData(step: ReviewStep): ReviewData {
  const order: ReviewStep[] = ['recap', 'newIdeas', 'arena', 'coldPick', 'bet'];
  return {
    period: '2026-W44', step, done: order.slice(0, order.indexOf(step)), betDue: true,
    addedIdeas: ['周末把书架整理成按主题分类'],
    duel: { left: { id: 'i9', text: '周末把书架整理成按主题分类', needs: null, lastTouchedAt: ago(0), isNew: true },
      right: { id: 'i2', text: '把读过的 Agent 文章整理成一份对比表', needs: '大量 token', lastTouchedAt: ago(48), isNew: false }, over: 2 },
    cold: { offered: [{ id: 'k1', text: '用树莓派做家里的温湿度看板', needs: '空闲树莓派', coldSince: ago(30) },
      { id: 'k2', text: '给常用命令写一个速查小工具', needs: null, coldSince: ago(75) }], poolFree: 1 },
    bet: { taskId: 'p1', task: '找工作', betEndsAt: ago(0), betWeeks: 4 },
    backpack: { inBackpack: [{ id: 'p1', name: '找工作', slot: '主线' }, { id: 'p2', name: '小游戏房间系统', slot: '支线' }], sideFree: true },
  };
}

/** 回看看板的预览接线：用演示数据直接算（不经 Ctx），选择也照真接线记在 localStorage 里。 */
function useDemoRecap(): RecapBoardProps {
  const demo = useMemo(() => recapDemo(), []);
  const [view, setView] = useState<RecapViewState>(DEFAULT_RECAP_VIEW), [bucket, setBucket] = useState<string | null>(null);
  useEffect(() => { void recapViewStore.read().then(r => setView(r.view)); }, []);
  const result = useMemo(() => computeRecap({ entries: demo.entries, cards: demo.cards, tasks: demo.tasks, lastReviewAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    firstUsedDay: demo.firstUsedDay, projectColors: Object.fromEntries(PREVIEW_PROJECTS.map(p => [p.name, p.color])), boundaryHour: 4, asOf: new Date().toISOString(),
    query: { period: view.period, from: view.from ?? undefined, to: view.to ?? undefined, dim: view.dim, includeIdle: view.includeIdle, bucket } }), [demo, view, bucket]);
  return { result, view, onView: v => { setView(v); void recapViewStore.write(v); }, bucket, onBucket: setBucket, today: result.today, minDay: result.earliestDay,
    projectColors: Object.fromEntries(PREVIEW_PROJECTS.map(p => [p.name, p.color])) };
}

/** 回顾页预览（只在开发时用）：?step=recap|newIdeas|arena|coldPick|bet；?step=done 看本期回顾已完成时的回看。 */
export function ReviewPreview({ step: initial }: { step: string }) {
  const [step, setStep] = useState<ReviewStep>((['recap', 'newIdeas', 'arena', 'coldPick', 'bet'].includes(initial) ? initial : 'recap') as ReviewStep);
  const actions: ReviewActions = { goto: s => setStep(s), addIdea() {}, duel() {}, takeCold() {}, skipCold() {}, continueBet() {}, switchMain() {}, finish() {} };
  const board = <RecapBoard {...useDemoRecap()} />;
  if (initial === 'done') return shell('review', <ReviewDonePage completedAt={new Date(Date.now() - 6 * 86_400_000).toISOString()} recap={board} />);
  return shell('review', <ReviewPage data={reviewData(step)} actions={actions} recap={board} />);
}

/** 设置页预览（只在开发时用）：?sec=deal|degrade|ideas|timer|lists|look|keys|window|automation|about。 */
export function SettingsPreview({ sec: initial }: { sec: string }) {
  const [sec, setSec] = useState(initial), [saves, setSaves] = useState(0);
  // 09 最近调用：演示数据里的自动化改动（&empty 看从未调用过）
  const recent = useMemo(() => new URLSearchParams(location.search).has('empty') ? [] : historyDemo().filter(r => r.source.kind === 'mcp' || r.source.kind === 'cli').slice(0, 5), []);
  const [s, setS] = useState<Settings>({ ...defaults, lists: { projects: [...PREVIEW_PROJECTS], tags: [...PREVIEW_TAGS], idleName: '待机',
    presets: [{ id: 'q1', name: '厕所', project: '生活', tags: [], mode: '插入', place: '弹层' }, { id: 'q2', name: '拿快递', project: '生活', tags: [], mode: '插入', place: '弹层' }, { id: 'q3', name: '刷视频', project: '休息', tags: [], mode: '插入', place: '弹层' },
      { id: 'f1', name: '学 408', project: '学习', tags: ['408'], mode: '切换', place: '计时条' }, { id: 'f2', name: '回消息', project: '工作', tags: [], mode: '切换', place: '计时条' }],
    restPool: [{ id: 'r1', name: '眺望窗外' }, { id: 'r2', name: '走走' }] } });
  return shell('settings', <SettingsPage section={sec} onSection={setSec} settings={s} version="0.3.0-beta.2" dataDir="D:\\Notes\\monorail"
    automationHost={{ loading: false, error: null, info: {
      executable: 'C:\\Users\\demo\\AppData\\Local\\Programs\\单轨\\单轨.exe',
      mcp_entry: 'C:\\Users\\demo\\AppData\\Local\\Programs\\单轨\\monorail-mcp.mjs',
      cli_entry: 'C:\\Users\\demo\\AppData\\Local\\Programs\\单轨\\monorail-cli.mjs',
      identifier: 'local.pixelrecord.app',
      pipe: '\\\\.\\pipe\\local.pixelrecord.app.mcp',
    } }}
    projects={s.lists.projects} knownTags={s.lists.tags}
    onCreateProject={name => { setS(x => ({ ...x, lists: { ...x.lists, projects: [...x.lists.projects, { name, color: '#00f5a0' }] } })); setSaves(n => n + 1); }}
    onCreateTag={tag => { setS(x => ({ ...x, lists: { ...x.lists, tags: [...x.lists.tags, tag] } })); setSaves(n => n + 1); }}
    onChange={(k, v) => { setS({ ...s, [k]: v }); setSaves(n => n + 1); }} onListsChange={lists => { setS(x => ({ ...x, lists: { ...x.lists, ...lists } })); setSaves(n => n + 1); }}
    onChangeDir={() => {}} errors={sec === 'keys' ? { mainHotkey: 'Ctrl+Alt+Shift+M 已被其他软件占用，没有生效' } : {}}
    automationRecent={<RecentCalls records={recent} today={activityDay(new Date().toISOString(), 4)} onOpen={() => {}} onAll={() => {}} />}
    automationRecentRight={recent.length ? `最近 ${recent.length} 条` : undefined} />, <SavedBadge saves={saves} />);
}
