import { useState } from 'react';
import { Frame, StatusBar } from '../../ui/frame/StatusBar';
import { TitleBar } from '../../ui/frame/TitleBar';
import { WindowButtons } from '../../ui/frame/WindowButtons';
import { StatusTag } from '../../ui/marks/StatusLed';
import { HistoryView } from '../../pages/list/history/HistoryView';
import { ViewToggle } from '../../pages/list/ViewToggle';
import type { ListView } from '../../pages/list/ViewToggle';
import type { HistoryChange, HistoryRecord, HistorySource } from '../../shared/history';
import { SYSTEM_WHY } from '../../shared/history';
import { activityDay } from '../../domain/timeline/day';

const TABS = [{ id: 'home', cn: '首页', en: 'HOME' }, { id: 'calendar', cn: '日历', en: 'CALENDAR' }, { id: 'list', cn: '列表', en: 'LIST' },
  { id: 'backpack', cn: '背包', en: 'BACKPACK' }, { id: 'review', cn: '回顾', en: 'REVIEW' }, { id: 'settings', cn: '设置', en: 'SETTINGS' }];
const pad = (n: number) => String(n).padStart(2, '0');

/* ---------- 演示数据：照 history-prototype.html 的 EVENTS，换成真的 HistoryRecord 格式 ---------- */
type C = [type: HistoryChange['type'], id: string, name: string, field: string, before: string | null, after: string | null];
const ch = (list: C[]): HistoryChange[] => list.map(([type, id, name, field, before, after]) => ({ type, id, name, field, before, after }));
const MAN = (page: string): HistorySource => ({ kind: 'manual', via: 'main', page });
const CD: HistorySource = { kind: 'mcp', agent: { name: 'Claude Desktop', raw: 'claude-ai', version: '0.14.2', detected_by: 'mcp_handshake' } };
const CUR: HistorySource = { kind: 'mcp', agent: { name: 'Cursor', raw: 'cursor-vscode', version: '1.0.0', detected_by: 'mcp_handshake' } };
const RAW: HistorySource = { kind: 'mcp', agent: { name: null, raw: 'my-home-agent', version: '0.1.0', detected_by: 'mcp_handshake' } };
const CC: HistorySource = { kind: 'cli', agent: { name: 'Claude Code', detected_by: 'env', evidence: 'CLAUDECODE=1' } };
const BAND: HistorySource = { kind: 'cli', agent: { name: '手环同步', detected_by: 'flag', evidence: '--agent 手环同步' } };
const NONE: HistorySource = { kind: 'cli', agent: { name: null, detected_by: 'none' } };

/** 今天往前 back 天、hh:mm:ss 的一条。subject、改动、调用照原型的几类典型操作。 */
export function historyDemo(now = Date.now(), boundaryHour = 4): HistoryRecord[] {
  let n = 0;
  // 按活动日取日期：凌晨日界之前打开时，「今天」是前一个日历日
  const at = (back: number, h: number, m: number, s = 0) => {
    const d = new Date(now); if (d.getHours() < boundaryHour) d.setDate(d.getDate() - 1);
    d.setDate(d.getDate() - back); d.setHours(h, m, s, 0); return d.toISOString();
  };
  const op = () => `019a${pad(n)}4b-26c4-7581-9b9e-2c0cdf9a8eb${n % 10}`;
  const rec = (when: string, source: HistorySource, label: string, subject: HistoryRecord['subject'], changes: C[], effects: C[] = [], more: Partial<HistoryRecord> = {}): HistoryRecord =>
    ({ version: 1, id: `demo${++n}`, at: when, day: activityDay(when, boundaryHour), action: 'test.direct', label, source, subject, changes: ch(changes), effects: ch(effects), ...more });
  const call = (method: string, params: object) => ({ call: { method, operation_id: op(), params: JSON.stringify(params), truncated: false } });
  const e = (id: string, text: string, meta: string) => ({ type: 'entry' as const, id, text, meta });
  return [
    rec(at(0, 21, 5, 33), CC, '停止计时', e('e1', '整理回看原型', '工作 · 19:30–21:05'),
      [['entry', 'e1', '整理回看原型', '时间', '11.08 19:30–至今', '11.08 19:30–21:05']], [], call('stop_timer', { expected_state: 'ts1:…' })),
    rec(at(0, 19, 30, 2), CD, '开始计时', e('e1', '整理回看原型', '工作 · #复盘'),
      [['entry', 'e1', '整理回看原型', '描述', null, '整理回看原型'], ['entry', 'e1', '整理回看原型', '项目', null, '工作'], ['entry', 'e1', '整理回看原型', '标签', null, '#复盘'], ['entry', 'e1', '整理回看原型', '时间', null, '11.08 19:30–至今']],
      [['entry', 'e0', '看纪录片', '时间', '11.08 19:02–至今', '11.08 19:02–19:30']], call('start_timer', { expected_state: 'ts1:…', description: '整理回看原型', project: '工作', tags: ['复盘'] })),
    rec(at(0, 18, 47, 51), { kind: 'manual', via: 'mini' }, '改读数', e('e0', '看纪录片', '娱乐 · 18:19 起'),
      [['entry', 'e0', '看纪录片', '时间', '11.08 18:07–至今', '11.08 18:19–至今']]),
    rec(at(0, 17, 20, 10), MAN('calendar'), '删除计时条目', e('e2', '上厕所', '生活 · 16:02–16:09'),
      [['entry', 'e2', '上厕所', '描述', '上厕所', null], ['entry', 'e2', '上厕所', '项目', '生活', null], ['entry', 'e2', '上厕所', '时间', '11.08 16:02–16:09', null]]),
    rec(at(0, 15, 12, 30), { kind: 'manual', via: 'quickbar' }, '捕获待办', { type: 'record', id: 'r1', text: '周一前给导师发开题提纲', meta: '待办' },
      [['record', 'r1', '周一前给导师发开题提纲', '内容', null, '周一前给导师发开题提纲'], ['record', 'r1', '周一前给导师发开题提纲', '类型', null, '待办']],
      [['card', 'c9', '周一前给导师发开题提纲', '内容', null, '周一前给导师发开题提纲'], ['card', 'c9', '周一前给导师发开题提纲', '状态', null, '待做'],
        ['task', 't9', '周一前给导师发开题提纲', '名称', null, '周一前给导师发开题提纲'], ['task', 't9', '周一前给导师发开题提纲', '槽位', null, '支线']]),
    rec(at(0, 14, 31, 46), CUR, '保存想法', { type: 'record', id: 'r2', text: '回看页可以加一个「连续投入天数」', meta: '想法' },
      [['record', 'r2', '回看页可以加一个「连续投入天数」', '内容', null, '回看页可以加一个「连续投入天数」 #单轨'], ['record', 'r2', '回看页可以加一个「连续投入天数」', '池', null, '活跃池']],
      [], call('save_idea', { text: '回看页可以加一个「连续投入天数」 #单轨', needs: null })),
    rec(at(0, 14, 2, 18), MAN('home'), '完成卡片', { type: 'card', id: 'c1', text: '[408] 操作系统 · 进程同步', meta: '408 考研复习' },
      [['card', 'c1', '[408] 操作系统 · 进程同步', '状态', '进行中', '已完成'], ['card', 'c1', '[408] 操作系统 · 进程同步', '做到哪了', '（空）', 'PV 操作经典题还剩读者写者']],
      [['entry', 'e3', '[408] 操作系统 · 进程同步', '时间', '11.08 10:02–至今', '11.08 10:02–14:02'], ['state', 'current_card', '计时状态', '当前卡', '[408] 操作系统 · 进程同步', '（无）']]),
    rec(at(0, 12, 10, 41), MAN('settings'), '改设置', { type: 'settings', id: 'accent', text: '强调色', meta: '' },
      [['settings', 'accent', '强调色', '强调色', '#00f5a0', '#20b8ff']], [], { merged: 3 }),
    rec(at(0, 9, 40, 33), BAND, '补录条目', e('e4', '晨跑 3km', '运动 · 07:00–07:30'),
      [['entry', 'e4', '晨跑 3km', '描述', null, '晨跑 3km'], ['entry', 'e4', '晨跑 3km', '项目', null, '运动'], ['entry', 'e4', '晨跑 3km', '标签', null, '#健身'], ['entry', 'e4', '晨跑 3km', '时间', null, '11.08 07:00–07:30']],
      [['entry', 'idle1', '待机', '时间', '11.08 06:10–08:00', '11.08 07:30–08:00']],
      call('add_time_entry', { description: '晨跑 3km', start: '2026-11-08T07:00:00+08:00', end: '2026-11-08T07:30:00+08:00', project: '运动', tags: ['健身'] })),
    rec(at(0, 4, 0, 2), { kind: 'system', trigger: 'dayChange' }, '活动日切换', null,
      [['record', 'r3', '学 Rust 宏', '池', '活跃池', '冷库'], ['state', 'home_mode', '计时状态', '首页', '任务卡', '回顾']], [], { why: SYSTEM_WHY.dayChange }),
    rec(at(1, 23, 2, 10), RAW, '停止计时', e('e5', '打游戏', '娱乐 · 21:40–23:02'),
      [['entry', 'e5', '打游戏', '时间', '11.07 21:40–至今', '11.07 21:40–23:02']], [], call('stop_timer', { expected_state: 'ts1:…' })),
    rec(at(1, 22, 10, 5), MAN('list'), '改条目', e('e5', '打游戏', '娱乐 · 21:40 起'),
      [['entry', 'e5', '打游戏', '描述', '游戏', '打游戏'], ['entry', 'e5', '打游戏', '项目', '未分类', '娱乐']]),
    rec(at(1, 7, 52, 10), { kind: 'system', trigger: 'resume' }, '补记离线时段', e('e6', '离线', '离线 · 01:10–07:50'),
      [['entry', 'e6', '离线', '描述', null, '离线'], ['entry', 'e6', '离线', '时间', null, '11.07 01:10–07:50']],
      [['entry', 'e7', '看纪录片', '时间', '11.07 00:30–至今', '11.07 00:30–01:10']], { why: SYSTEM_WHY.resume }),
    rec(at(2, 21, 0, 3), NONE, '停止计时', e('e8', '[408] 计网 · 传输层', '学习 · 18:00–21:00'),
      [['entry', 'e8', '[408] 计网 · 传输层', '时间', '11.06 18:00–至今', '11.06 18:00–21:00']], [['card', 'c2', '[408] 计网 · 传输层', '状态', '进行中', '待做']], call('stop_timer', { expected_state: 'ts1:…' })),
    rec(at(2, 15, 28, 51), CD, '开始临时活动', e('e9', '接电话', '生活 · 15:28 起'),
      [['entry', 'e9', '接电话', '描述', null, '接电话'], ['entry', 'e9', '接电话', '类型', null, '插入']], [], call('start_break', { expected_state: 'ts1:…', activity: '接电话' })),
    rec(at(9, 10, 20, 56), CC, '保存想法', { type: 'record', id: 'r4', text: '周末去爬一次香山', meta: '想法' },
      [['record', 'r4', '周末去爬一次香山', '内容', null, '周末去爬一次香山']], [], call('save_idea', { text: '周末去爬一次香山', needs: null })),
  ];
}

/** 列表 · 操作历史预览（只在开发时用）：?page=history；&empty 看从未有过记录。数据是演示数据，不经 Ctx。 */
export function HistoryPreview({ empty }: { empty: boolean }) {
  const [view, setView] = useState<ListView>('history'), [days, setDays] = useState(7);
  const all = empty ? [] : historyDemo(), today = activityDay(new Date().toISOString(), 4);
  const from = (() => { const [y, m, d] = today.split('-').map(Number), t = new Date(y, m - 1, d - (days - 1)); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; })();
  const title = <TitleBar name="单轨" tabs={TABS} active="list" onTab={() => {}}>
    <StatusTag kind="focus" label="写周报" time="40:12" />
    <WindowButtons pinned={false} maximized={false} onPin={() => {}} onMinimize={() => {}} onMaximize={() => {}} onClose={() => {}} />
  </TitleBar>;
  return <Frame titleBar={title} statusBar={<StatusBar left={<span>快捷活动</span>} />}>
    {view === 'history'
      ? <HistoryView data={{ records: all.filter(r => r.day >= from), bad: 0, older: all.some(r => r.day < from) }} days={days} today={today}
        toggle={<ViewToggle value={view} onChange={setView} />} onMore={() => setDays(d => d + 7)} onLocate={() => {}} onCopy={() => {}} />
      : <section className="pg"><div className="s-head"><ViewToggle value={view} onChange={setView} /></div><p className="ls-empty">计时记录见 ?page=list。</p></section>}
  </Frame>;
}
