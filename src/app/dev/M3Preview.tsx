import type { ReactElement } from 'react';
import { useState } from 'react';
import { Frame, StatusBar } from '../../ui/frame/StatusBar';
import { TitleBar } from '../../ui/frame/TitleBar';
import { WindowButtons } from '../../ui/frame/WindowButtons';
import type { ReviewActions, ReviewData, ReviewStep } from '../../pages/review/ReviewPage';
import { ReviewPage } from '../../pages/review/ReviewPage';
import { SavedBadge, SettingsPage } from '../../pages/settings/SettingsPage';
import type { Settings } from '../../shared/settings';
import { defaults } from '../../shared/settings';
import { BaselineMarks } from '../shell/BaselineMarks';

const TABS = [{ id: 'home', cn: '首页', en: 'HOME' }, { id: 'backpack', cn: '背包', en: 'BACKPACK' }, { id: 'review', cn: '回顾', en: 'REVIEW' }, { id: 'settings', cn: '设置', en: 'SETTINGS' }];
const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const shell = (active: string, body: ReactElement, right?: ReactElement) => <Frame
  titleBar={<TitleBar name="像素记录" tabs={TABS} active={active} onTab={() => {}}>
    <WindowButtons pinned={false} maximized={false} onPin={() => {}} onMinimize={() => {}} onMaximize={() => {}} onClose={() => {}} />
  </TitleBar>}
  statusBar={<StatusBar right={<>{right}<BaselineMarks main side /></>} />}>{body}</Frame>;

function reviewData(step: ReviewStep): ReviewData {
  const order: ReviewStep[] = ['recap', 'newIdeas', 'arena', 'coldPick', 'bet'];
  return {
    period: '2026-W44', step, done: order.slice(0, order.indexOf(step)), betDue: true,
    recap: {
      completed: [
        { id: 'c1', content: '找 3 个 JD', project: '找工作', day: '10-27', minutes: 35 },
        { id: 'c2', content: '沿 [Python] 往下学 1 小时', project: '找工作', day: '10-28', minutes: 64 },
        { id: 'c3', content: '查一下几台服务器有没有被攻击', project: '散件', day: '10-29', minutes: 22 }],
      totals: [{ category: '主线', minutes: 412 }, { category: '支线', minutes: 180 }, { category: '生活', minutes: 95 }, { category: '休息', minutes: 40 }],
      notes: [{ id: 'n1', content: '沿 [Python] 往下学 1 小时', note: '看完装饰器，下一步写小练习' }],
    },
    addedIdeas: ['周末把书架整理成按主题分类'],
    duel: { left: { id: 'i9', text: '周末把书架整理成按主题分类', needs: null, lastTouchedAt: ago(0), isNew: true },
      right: { id: 'i2', text: '把读过的 Agent 文章整理成一份对比表', needs: '大量 token', lastTouchedAt: ago(48), isNew: false }, over: 2 },
    cold: { offered: [{ id: 'k1', text: '用树莓派做家里的温湿度看板', needs: '空闲树莓派', coldSince: ago(30) },
      { id: 'k2', text: '给常用命令写一个速查小工具', needs: null, coldSince: ago(75) }], poolFree: 1 },
    bet: { project: '找工作', betEndsAt: ago(0), betWeeks: 4 },
    backpack: { inBackpack: [{ id: 'p1', name: '找工作', slot: '主线', slotIndex: 1 }, { id: 'p2', name: '小游戏房间系统', slot: '支线', slotIndex: 2 }], sideFree: true },
  };
}

/** 回顾页预览（只在开发时用）：?step=recap|newIdeas|arena|coldPick|bet。 */
export function ReviewPreview({ step: initial }: { step: string }) {
  const [step, setStep] = useState<ReviewStep>((['recap', 'newIdeas', 'arena', 'coldPick', 'bet'].includes(initial) ? initial : 'recap') as ReviewStep);
  const actions: ReviewActions = { goto: s => setStep(s), addIdea() {}, duel() {}, takeCold() {}, skipCold() {}, continueBet() {}, switchMain() {}, finish() {} };
  return shell('review', <ReviewPage data={reviewData(step)} actions={actions} />);
}

/** 设置页预览（只在开发时用）：?sec=deal|degrade|ideas|timer|lists|look|keys|window|about。 */
export function SettingsPreview({ sec: initial }: { sec: string }) {
  const [sec, setSec] = useState(initial), [saves, setSaves] = useState(0);
  const [s, setS] = useState<Settings>({ ...defaults, lists: { idleName: '待机',
    quickActivities: [{ id: 'q1', name: '厕所', category: '生活' }, { id: 'q2', name: '拿快递', category: '生活' }, { id: 'q3', name: '刷视频', category: '休息' }],
    restPool: [{ id: 'r1', name: '眺望窗外' }, { id: 'r2', name: '走走' }] } });
  return shell('settings', <SettingsPage section={sec} onSection={setSec} settings={s} version="0.1.0" dataDir="D:\\Notes\\pixel-record"
    onChange={(k, v) => { setS({ ...s, [k]: v }); setSaves(n => n + 1); }} onListsChange={lists => { setS({ ...s, lists }); setSaves(n => n + 1); }}
    onChangeDir={() => {}} errors={sec === 'keys' ? { mainHotkey: 'Ctrl+Alt+Shift+M 已被其他软件占用，没有生效' } : {}} />, <SavedBadge saves={saves} />);
}
