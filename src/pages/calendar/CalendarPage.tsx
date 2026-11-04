import { useEffect, useState } from 'react';
import { PageFrame } from '../../ui/layout/PageFrame';
import { Segmented } from '../../ui/controls/Segmented';
import { Switch } from '../../ui/controls/Switch';
import type { ProjectOption } from '../../ui/controls/ProjectPicker';
import { Icon } from '../../ui/icons/Icon';
import { activityDayStart, addDays } from '../../shared/time';
import { CAL_ZOOMS, isoWeek, viewDays } from './grid';
import type { CalZoom } from './grid';
import { CalendarBoard } from './CalendarBoard';
import type { CalEntry } from './CalendarBoard';
import { EntryPopover } from './EntryPopover';
import type { EntryPatch } from './EntryPopover';
import './calendar.css';

export interface CalendarEntry extends CalEntry { tags: string[] }

/** 日历页要的动作。时刻都是毫秒；由外壳的接线层交给计时系统（timeEditService），出错由接线层报告。 */
export interface CalendarActions {
  /** 新建一条条目，交回它的 id，用来打开编辑框 */
  create(start: number, end: number): Promise<string | undefined>;
  update(id: string, start: number, end: number | null): void;
  copy(id: string, start: number): void;
  patch(id: string, patch: EntryPatch): void;
  /** 弹窗里改开始、结束、时长：交输入的原文，和列表一样由计时系统解析（0.3.0-beta.3 D3） */
  setStart(id: string, text: string): void;
  setEnd(id: string, text: string): void;
  setDuration(id: string, text: string): void;
  continueEntry(id: string): void;
  favorite(id: string): void;
  saveAsCard(id: string): void;
  remove(id: string): void;
  createProject(name: string): void;
  createTag(tag: string): void;
  setShowIdle(on: boolean): void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const MIN = 60_000;
let lastZoom: CalZoom = 1;

/** 每 30 秒刷新一次「现在」：正在计时的块变长、现在线往下走。 */
function useNow(period = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), period); return () => clearInterval(id); }, [period]);
  return now;
}

/**
 * 日历页（设计文档「计时 · 日历」）：日 / 周视图，周一开始；每天从日边界画到次日日边界。
 * 条目按项目上色，待机可以隐藏。点一条打开弹窗；新建以后也直接打开弹窗，好填描述。
 */
export function CalendarPage({ entries, projects, knownTags, boundaryHour, snapMinutes, showIdle, isIdle, actions, onRange, focusDay }:
  { entries: readonly CalendarEntry[]; projects: ProjectOption[]; knownTags: string[]; boundaryHour: number; snapMinutes: number;
    showIdle: boolean; isIdle: (e: CalEntry) => boolean; actions: CalendarActions; onRange?: (start: number, end: number) => void;
    /** 从操作历史 ◎ 定位过来：切到日视图看这一天（活动日开始时刻）；seq 变了就再跳一次 */
    focusDay?: { day: number; seq: number } | null }) {
  const now = useNow();
  const [view, setView] = useState<'day' | 'week'>('week'), [shift, setShift] = useState(0), [zoom, setZoom] = useState<CalZoom>(() => lastZoom);
  const pickZoom = (next: CalZoom) => { lastZoom = next; setZoom(next); };
  const [pop, setPop] = useState<{ id: string; x: number; y: number } | null>(null);
  const days = viewDays(now, boundaryHour, view, shift), today = activityDayStart(now, boundaryHour);
  // 看的是哪几天交给接线层，它按这个范围查条目
  const first = days[0], end = addDays(days[days.length - 1], 1);
  useEffect(() => { onRange?.(first, end); }, [first, end, onRange]);
  // 夏令时那天是 23 / 25 小时，四舍五入到整天
  useEffect(() => { if (focusDay) { setView('day'); setShift(Math.round((focusDay.day - today) / 86_400_000)); } }, [focusDay?.seq]);
  const colorOf = (name: string) => projects.find(p => p.name === name)?.color ?? 'var(--mute-2)';
  const open = pop && entries.find(e => e.id === pop.id);
  const no = view === 'day' ? pad(new Date(days[0]).getDate()) : `W${isoWeek(days[3])}`;
  const tools = <>
    <div className="cal-nav">
      <button type="button" className="flip" title="往前" onClick={() => setShift(shift - 1)}><Icon name="arrow" /></button>
      <button type="button" className="today" onClick={() => setShift(0)}>{view === 'day' ? '今天' : '本周'}</button>
      <button type="button" title="往后" onClick={() => setShift(shift + 1)}><Icon name="arrow" /></button>
    </div>
    <Segmented label="视图" value={view} onChange={v => { setView(v); setShift(0); }} options={[{ value: 'day', label: '日' }, { value: 'week', label: '周' }]} />
    <Segmented label="比例" value={String(zoom)} onChange={v => pickZoom(Number(v) as CalZoom)}
      options={CAL_ZOOMS.map(z => ({ value: String(z), label: `${z}×` }))} />
    <span className="pg-switch"><Switch checked={showIdle} onChange={actions.setShowIdle} label="显示待机" /><span>显示待机</span></span>
  </>;
  // 复制到它后面那一段；后面放不下（会超过现在）就复制到它前面
  const copyNext = (e: CalendarEntry) => {
    const start = Date.parse(e.started_at), end = Date.parse(e.ended_at!), len = end - start;
    actions.copy(e.id, end + len <= Date.now() ? end : start - len);
  };
  return <PageFrame className="cal" no={no} en="CALENDAR" cn="日历" tools={tools}>
    <div style={{ display: 'contents' }} onPointerDownCapture={() => setPop(null)}>
      <CalendarBoard days={days} today={today} now={now} entries={entries} isIdle={isIdle} showIdle={showIdle} colorOf={colorOf}
        step={snapMinutes * MIN} boundaryHour={boundaryHour} zoom={zoom} onZoom={pickZoom}
        onCreate={(start, end, x, y) => void actions.create(start, end).then(id => { if (id) setPop({ id, x, y }); })}
        onChange={actions.update} onCopy={actions.copy} onOpen={(id, x, y) => setPop({ id, x, y })} />
    </div>
    {open && <EntryPopover entry={open} x={pop.x} y={pop.y} now={now} projects={projects} knownTags={knownTags} onClose={() => setPop(null)}
      onPatch={patch => actions.patch(open.id, patch)} onContinue={() => actions.continueEntry(open.id)} onCopy={() => copyNext(open)}
      onFavorite={() => actions.favorite(open.id)} onSaveAsCard={() => actions.saveAsCard(open.id)} onDelete={() => actions.remove(open.id)}
      onCreateProject={actions.createProject} onCreateTag={actions.createTag}
      onSetStart={text => actions.setStart(open.id, text)} onSetEnd={text => actions.setEnd(open.id, text)} onSetDuration={text => actions.setDuration(open.id, text)} />}
  </PageFrame>;
}
