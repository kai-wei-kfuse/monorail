import { useState } from 'react';
import { Frame, StatusBar } from '../../ui/frame/StatusBar';
import { TitleBar } from '../../ui/frame/TitleBar';
import { WindowButtons } from '../../ui/frame/WindowButtons';
import { StatusTag } from '../../ui/marks/StatusLed';
import { ListPage } from '../../pages/list/ListPage';
import type { ListEntry } from '../../pages/list/listGroups';
import { PREVIEW_PROJECTS, PREVIEW_TAGS, previewEntries } from './CalendarPreview';

const MIN = 60_000, HOUR = 60 * MIN;
const TABS = [{ id: 'home', cn: '首页', en: 'HOME' }, { id: 'calendar', cn: '日历', en: 'CALENDAR' }, { id: 'list', cn: '列表', en: 'LIST' },
  { id: 'backpack', cn: '背包', en: 'BACKPACK' }, { id: 'review', cn: '回顾', en: 'REVIEW' }, { id: 'settings', cn: '设置', en: 'SETTINGS' }];

// 预览里只认最简单的写法：时刻 9:30，时长 90 或 1:30。真实的解析在计时系统里（domain/timeline/duration）
const atClock = (base: number, text: string) => { const m = /^(\d{1,2}):?(\d{2})$/.exec(text); if (!m) return NaN; const d = new Date(base); d.setHours(+m[1], +m[2], 0, 0); return d.getTime(); };
const minutes = (text: string) => { const m = /^(?:(\d+):)?(\d+)$/.exec(text); return m ? ((+(m[1] ?? 0)) * 60 + +m[2]) * MIN : NaN; };

/** 列表页预览（只在开发时用）：同日历预览的数据，再加一条当天的「学 408」，好看合并同类。改动直接改内存里的数据。 */
export function ListPreview() {
  const [entries, setEntries] = useState<ListEntry[]>(() => {
    const now = Date.now(), iso = (t: number) => new Date(t).toISOString();
    return [...previewEntries(now), { id: 'a2', started_at: iso(now - 8 * HOUR), ended_at: iso(now - 7 * HOUR), description: '学 408', project: '学习', tags: ['408'], card_id: null }];
  });
  const [projects, setProjects] = useState(PREVIEW_PROJECTS), [tags, setTags] = useState(PREVIEW_TAGS), [showIdle, setShowIdle] = useState(false);
  const edit = (id: string, f: (e: ListEntry) => ListEntry | null) => setEntries(list => list.flatMap(e => e.id !== id ? [e] : (r => r ? [r] : [])(f(e))));
  const iso = (t: number) => new Date(t).toISOString();
  const title = <TitleBar name="单轨" tabs={TABS} active="list" onTab={() => {}}>
    <StatusTag kind="focus" label="写周报" time="40:12" />
    <WindowButtons pinned={false} maximized={false} onPin={() => {}} onMinimize={() => {}} onMaximize={() => {}} onClose={() => {}} />
  </TitleBar>;
  return <Frame titleBar={title} statusBar={<StatusBar left={<span>快捷活动</span>} right={<><span>主线 ✓</span><span>支线 ·</span></>} />}>
    <ListPage entries={entries} projects={projects} knownTags={tags} boundaryHour={4} isIdle={e => e.project === '待机'} showIdle={showIdle} onShowIdle={setShowIdle} actions={{
      patch: (id, patch) => edit(id, e => ({ ...e, ...patch })),
      setStart: (id, text) => edit(id, e => { const t = atClock(Date.parse(e.started_at), text); return Number.isFinite(t) ? { ...e, started_at: iso(t) } : e; }),
      setEnd: (id, text) => edit(id, e => { const t = atClock(Date.parse(e.started_at), text); return Number.isFinite(t) && t > Date.parse(e.started_at) ? { ...e, ended_at: iso(t) } : e; }),
      setDuration: (id, text) => edit(id, e => { const ms = minutes(text); return ms > 0 ? { ...e, ended_at: iso(Math.min(Date.now(), Date.parse(e.started_at) + ms)) } : e; }),
      continueEntry: () => {}, favorite: () => {}, saveAsCard: () => {},
      copy: id => setEntries(list => { const e = list.find(x => x.id === id)!, len = Date.parse(e.ended_at!) - Date.parse(e.started_at);
        return [...list, { ...e, id: crypto.randomUUID(), started_at: iso(Date.parse(e.started_at) - len), ended_at: e.started_at }]; }),
      remove: id => edit(id, () => null),
      createProject: name => setProjects(list => [...list, { name, color: '#16a085' }]),
      createTag: tag => setTags(list => [...list, tag]),
    }} />
  </Frame>;
}
