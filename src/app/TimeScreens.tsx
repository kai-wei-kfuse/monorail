import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { defaults } from '../shared/settings';
import { appStore } from '../store/appStore';
import { CalendarPage } from '../pages/calendar/CalendarPage';
import type { CalendarActions } from '../pages/calendar/CalendarPage';
import { ListPage } from '../pages/list/ListPage';
import type { ListActions } from '../pages/list/EntryRow';
import type { Ctx } from '../services/commit';
import type { HistoryRecord, HistorySource } from '../shared/history';
import { ViewToggle } from '../pages/list/ViewToggle';
import type { ListView } from '../pages/list/ViewToggle';
import { HistoryView } from '../pages/list/history/HistoryView';
import { today as historyToday } from '../services/historyService';
import { useHistoryPage } from './useHistory';

/** 设置 09 跳过来要打开的一条（day 用来放宽已载入的天数）。 */
export interface HistoryFocus { id: string; day: string; seq: number }
import * as edit from '../services/timeEditService';
import * as preset from '../services/presetService';
import { continueEntry } from '../services/homeService';

const now = () => new Date().toISOString();
const isIdle = (e: { project: string }) => e.project === '待机';

/** 操作历史里记的页面（ADR 0019 第 5 条）：日历和列表共用同一批入口，由这里分开。 */
const pageSource = (page: 'calendar' | 'list'): HistorySource => ({ kind: 'manual', via: 'main', page });

/** 日历和列表共用的动作（N5 接线草案 evidence/n5-contracts.md）。出错交给 report，不吞掉。 */
function useEntryActions(ctx: Ctx, report: (error: unknown) => void, source: HistorySource) {
  const call = (work: () => Promise<unknown>) => { void work().catch(report); };
  return {
    patch: (id: string, patch: Parameters<typeof edit.patch>[2]) => call(() => edit.patch(ctx, id, patch, now(), source)),
    // 改起止和时长交原文，由计时系统解析；日历弹窗和列表行共用（0.3.0-beta.3 D3）
    setStart: (id: string, text: string) => call(() => edit.setStart(ctx, id, text, now(), source)),
    setEnd: (id: string, text: string) => call(() => edit.setEnd(ctx, id, text, now(), source)),
    setDuration: (id: string, text: string) => call(() => edit.setDuration(ctx, id, text, now(), source)),
    continueEntry: (id: string) => call(() => continueEntry(ctx, id, now(), source)),
    favorite: (id: string) => call(() => preset.favorite(ctx, id, now(), source)),
    saveAsCard: (id: string) => call(() => edit.saveAsCard(ctx, id, now(), source)),
    remove: (id: string) => call(() => edit.remove(ctx, id, now(), source)),
    createProject: (name: string) => call(() => preset.createProject(ctx, name, now(), source)),
    createTag: (tag: string) => call(() => preset.createTag(ctx, tag, now(), source)),
  };
}

/** 页面要的公共数据：项目（任务池投影里的，带颜色）、已知标签、日边界、显示待机；dataVersion 变了就重新查。 */
function useShared() {
  const projects = useStore(appStore, s => s.backpack.pool.projects), knownTags = useStore(appStore, s => s.home.knownTags);
  const version = useStore(appStore, s => s.home.dataVersion), settings = useStore(appStore, s => s.settings);
  // 宽松模式（ADR 0021 第 13 条）：日历、列表不显示待机，calendarShowIdle 不读
  // 宽松模式下〔显示待机〕开关也不显示（G6 审核 S1：点了不起作用）
  const loose = settings.trackingMode === 'loose';
  return { projects, knownTags, version, boundaryHour: settings.dayBoundaryHour, showIdle: loose ? false : settings.calendarShowIdle, idleToggle: !loose };
}

/** 日历页的接线：按页面在看的那几天查条目。focusDay：从操作历史 ◎ 定位过来要看的那一天。 */
export function CalendarScreen({ ctx, report, focusDay }: { ctx: Ctx; report: (error: unknown) => void; focusDay?: DayFocus | null }) {
  const { projects, knownTags, version, boundaryHour, showIdle, idleToggle } = useShared();
  const [range, setRange] = useState<[number, number] | null>(null);
  const onRange = useCallback((start: number, end: number) => setRange(r => r && r[0] === start && r[1] === end ? r : [start, end]), []);
  // version 只用来在数据变了以后重新查
  const entries = useMemo(() => range ? edit.queryRange(ctx, range[0], range[1]) : [], [ctx, range, version]);
  const source = pageSource('calendar'), shared = useEntryActions(ctx, report, source);
  const actions: CalendarActions = {
    ...shared,
    create: (start, end) => edit.create(ctx, start, end, now(), undefined, source).catch(error => { report(error); return undefined; }),
    update: (id, start, end) => void edit.update(ctx, id, start, end, now(), source).catch(report),
    copy: (id, start) => void edit.copy(ctx, id, now(), start, source).catch(report),
    setShowIdle: on => void edit.setShowIdle(ctx, on, now(), source).catch(report),
  };
  // 日历吸附最小间隔统一取 shared/settings.ts 的 defaults.calendarSnapMinutes（1 分钟），不改写用户既有 settings.yaml。
  return <CalendarPage entries={entries} projects={projects} knownTags={knownTags} boundaryHour={boundaryHour} snapMinutes={defaults.calendarSnapMinutes}
    showIdle={showIdle} idleToggle={idleToggle} isIdle={isIdle} actions={actions} onRange={onRange} focusDay={focusDay} />;
}

export interface DayFocus { day: number; seq: number }

/**
 * 列表页的接线：〔计时记录 | 操作历史〕。计时记录按最近几天查条目，改起止和时长交原文，由计时系统解析；
 * 操作历史按需经 historyService 查（E8c）。view、focus 由外壳持有，设置 09 跳过来时能直接打开某一条。
 */
export function ListScreen({ ctx, report, view, onView, historyFocus, focusDay, onLocate, onCopied }:
  { ctx: Ctx; report: (error: unknown) => void; view: ListView; onView: (v: ListView) => void; historyFocus?: HistoryFocus | null;
    focusDay?: DayFocus | null; onLocate: (r: HistoryRecord) => void; onCopied?: (text: string) => void }) {
  const { projects, knownTags, version, boundaryHour, showIdle, idleToggle } = useShared();
  const [days, setDays] = useState(7), [historyDays, setHistoryDays] = useState(7);
  const entries = useMemo(() => edit.recentEntries(ctx, days), [ctx, days, version]);   // version：数据变了以后重新查
  // 跳过来的那一条早于已载入的天数时放宽到包含它
  const today = historyToday(ctx);
  useEffect(() => {
    const day = historyFocus && historyFocus.day;
    if (!day) return;
    const back = Math.round((Date.parse(`${today}T12:00:00`) - Date.parse(`${day}T12:00:00`)) / 86_400_000) + 1;
    setHistoryDays(d => back > d ? Math.ceil(back / 7) * 7 : d);
  }, [historyFocus?.seq]);
  const page = useHistoryPage(ctx, historyDays, view === 'history');
  const source = pageSource('list'), shared = useEntryActions(ctx, report, source);
  const actions: ListActions = {
    ...shared,
    copy: id => void edit.copy(ctx, id, now(), undefined, source).catch(report),
  };
  const toggle = <ViewToggle value={view} onChange={onView} />;
  if (view === 'history') {
    const onCopy = (text: string) => { void navigator.clipboard.writeText(text).then(() => onCopied?.(text), report); };
    return <HistoryView data={page.data} error={page.error} days={historyDays} today={today} toggle={toggle} focus={historyFocus}
      onMore={() => setHistoryDays(d => d + 7)} onLocate={onLocate} onCopy={onCopy} />;
  }
  return <ListPage entries={entries} projects={projects} knownTags={knownTags} boundaryHour={boundaryHour} isIdle={isIdle} actions={actions}
    showIdle={showIdle} idleToggle={idleToggle} onShowIdle={on => void edit.setShowIdle(ctx, on, now(), source).catch(report)} onDays={setDays} toggle={toggle} focusDay={focusDay} />;
}
