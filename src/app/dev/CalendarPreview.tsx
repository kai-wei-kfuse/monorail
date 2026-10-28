import { useState } from 'react';
import { Frame, StatusBar } from '../../ui/frame/StatusBar';
import { TitleBar } from '../../ui/frame/TitleBar';
import { WindowButtons } from '../../ui/frame/WindowButtons';
import { StatusTag } from '../../ui/marks/StatusLed';
import type { ProjectOption } from '../../ui/controls/ProjectPicker';
import { CalendarPage } from '../../pages/calendar/CalendarPage';
import type { CalendarEntry } from '../../pages/calendar/CalendarPage';

const MIN = 60_000, HOUR = 60 * MIN;
const TABS = [{ id: 'home', cn: '首页', en: 'HOME' }, { id: 'calendar', cn: '日历', en: 'CALENDAR' }, { id: 'list', cn: '列表', en: 'LIST' },
  { id: 'backpack', cn: '背包', en: 'BACKPACK' }, { id: 'review', cn: '回顾', en: 'REVIEW' }, { id: 'settings', cn: '设置', en: 'SETTINGS' }];
export const PREVIEW_PROJECTS: ProjectOption[] = [{ name: '待机', color: '#a3a39e' }, { name: '未分类', color: '#888884' }, { name: '求职', color: '#ff5a3c' },
  { name: '学习', color: '#00b4ff' }, { name: '生活', color: '#d9a400' }, { name: '运动', color: '#00c389' }, { name: '工作', color: '#8f6bff' }];
export const PREVIEW_TAGS = ['408', 'python', '面试', '户外'];

/** 以「现在」为准往前倒推的示例条目：两条互相重叠，一条来自卡，一段待机，一条正在计时，前一天还有两条。 */
export function previewEntries(now = Date.now()): CalendarEntry[] {
  const ago = (h: number, m = 0) => new Date(now - h * HOUR - m * MIN).toISOString();
  const e = (id: string, s: string, f: string | null, description: string, project: string, extra: Partial<CalendarEntry> = {}): CalendarEntry =>
    ({ id, started_at: s, ended_at: f, description, project, tags: [], card_id: null, ...extra });
  return [
    e('y1', ago(30), ago(28, 30), '学 408', '学习', { tags: ['408'] }),
    e('y2', ago(26), ago(25), '跑步', '运动', { tags: ['户外'] }),
    e('a', ago(6), ago(5), '学 408', '学习', { tags: ['408'] }),
    e('b', ago(5, 20), ago(4, 40), '回邮件', '工作'),
    e('c', ago(4, 40), ago(4, 30), '厕所', '生活'),
    e('d', ago(4, 30), ago(3), '改简历的项目经历', '求职', { card_id: 'c2' }),
    e('idle', ago(3), ago(0, 40), '待机', '待机'),
    e('run', ago(0, 40), null, '写周报', '工作'),
  ];
}

/** 日历页预览（只在开发时用）：拖动、新建、修改都直接改内存里的数据，不走计时系统的覆盖规则。 */
export function CalendarPreview() {
  const [entries, setEntries] = useState(() => previewEntries());
  const [projects, setProjects] = useState(PREVIEW_PROJECTS), [tags, setTags] = useState(PREVIEW_TAGS), [showIdle, setShowIdle] = useState(true);
  const iso = (t: number) => new Date(t).toISOString();
  const edit = (id: string, f: (e: CalendarEntry) => CalendarEntry) => setEntries(list => list.map(e => e.id === id ? f(e) : e));
  const title = <TitleBar name="单轨" tabs={TABS} active="calendar" onTab={() => {}}>
    <StatusTag kind="focus" label="写周报" time="40:12" />
    <WindowButtons pinned={false} maximized={false} onPin={() => {}} onMinimize={() => {}} onMaximize={() => {}} onClose={() => {}} />
  </TitleBar>;
  return <Frame titleBar={title} statusBar={<StatusBar left={<span>快捷活动</span>} right={<><span>主线 ✓</span><span>支线 ·</span></>} />}>
    <CalendarPage entries={entries} projects={projects} knownTags={tags} boundaryHour={4} snapMinutes={5} showIdle={showIdle}
      isIdle={e => e.project === '待机'} actions={{
        create: async (start, end) => {
          const id = crypto.randomUUID();
          setEntries(list => [...list, { id, started_at: iso(start), ended_at: iso(end), description: '（新记录）', project: '未分类', tags: [], card_id: null }]);
          return id;
        },
        update: (id, start, end) => edit(id, e => ({ ...e, started_at: iso(start), ended_at: end === null ? null : iso(end) })),
        copy: (id, start) => setEntries(list => { const e = list.find(x => x.id === id)!, len = Date.parse(e.ended_at!) - Date.parse(e.started_at);
          return [...list, { ...e, id: crypto.randomUUID(), started_at: iso(start), ended_at: iso(start + len) }]; }),
        patch: (id, patch) => edit(id, e => ({ ...e, ...patch })),
        continueEntry: () => {}, favorite: () => {}, saveAsCard: () => {},
        remove: id => setEntries(list => list.filter(e => e.id !== id)),
        createProject: name => setProjects(list => [...list, { name, color: '#16a085' }]),
        createTag: tag => setTags(list => [...list, tag]),
        setShowIdle,
      }} />
  </Frame>;
}
