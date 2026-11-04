import type { CSSProperties, PointerEvent } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { beginBoardDrag, dayHeight, dayTotal, endBoardDrag, HOUR_PX, layoutDay, moveBoardDrag, piece, stepZoom, timeAt, zoomScrollTop } from './grid';
import type { BoardDragState, BoardGhost, CalZoom, Span } from './grid';
import './calendar.css';

export interface CalEntry extends Span { description: string; project: string; card_id: string | null }

const MIN = 60_000;
const CN = ['日', '一', '二', '三', '四', '五', '六'], EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const pad = (n: number) => String(n).padStart(2, '0');
const clock = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const hm = (ms: number) => { const m = Math.round(ms / MIN); return `${Math.floor(m / 60)}h${pad(m % 60)}`; };

/**
 * 日历的看板：表头（日期和当天合计）、时刻列、每天一列（日边界画到次日日边界）、条目块、现在线、拖动时的影子。
 * 只负责画和拖，拖完把结果交给回调；条目怎么改由调用方决定。
 * - 点空白处：在那里建一块 30 分钟的（不晚于现在）；拖空白处：按拖过的范围建。都交给 onCreate，附上松手的位置，方便打开编辑框。
 * - 拖块的上下边改起止，拖整块移动（可以拖到别的日子），按住 Ctrl 拖是复制。正在计时的块只能拖开始边。
 * - 点一下块交给 onOpen。
 */
export function CalendarBoard({ days, today, now, entries, isIdle, showIdle, colorOf, step, boundaryHour, zoom = 1, onZoom, onCreate, onChange, onCopy, onOpen }:
  { days: number[]; today: number; now: number; entries: readonly CalEntry[]; isIdle: (e: CalEntry) => boolean; showIdle: boolean;
    colorOf: (project: string) => string; step: number; boundaryHour: number; zoom?: CalZoom; onZoom?: (zoom: CalZoom) => void;
    onCreate: (start: number, end: number, x: number, y: number) => void; onChange: (id: string, start: number, end: number | null) => void;
    onCopy: (id: string, start: number) => void; onOpen: (id: string, x: number, y: number) => void }) {
  const hourPx = HOUR_PX * zoom, prevHourPx = useRef(hourPx), lastScrollTop = useRef(0);
  const cols = useRef<(HTMLDivElement | null)[]>([]), scroller = useRef<HTMLDivElement>(null), drag = useRef<BoardDragState | null>(null);
  const [ghost, setGhost] = useState<BoardGhost | null>(null);
  const real = entries.filter(e => !isIdle(e)), idle = entries.filter(isIdle);
  // 打开时滚到「现在」往上 4 小时的位置；切换缩放比例时保持视口中心时刻不变
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = Math.max(0, (now - today) / 3_600_000 * hourPx - 4 * hourPx);
    lastScrollTop.current = el.scrollTop;
  }, [days.length]);
  useLayoutEffect(() => {
    const el = scroller.current, prev = prevHourPx.current;
    prevHourPx.current = hourPx;
    if (!el || prev === hourPx) return;
    // DOM 已按新比例渲染，当前 scrollTop 可能已被浏览器夹紧，必须用先前记录的位置。
    el.scrollTop = zoomScrollTop(lastScrollTop.current, el.clientHeight, hourPx / prev);
    lastScrollTop.current = el.scrollTop;
  }, [hourPx]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !onZoom) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (e.deltaY === 0) return;
      if (acc * e.deltaY < 0) acc = 0;
      acc += e.deltaY;
      if (Math.abs(acc) < 40) return;
      const dir = acc < 0 ? 1 : -1;
      acc = 0;
      onZoom(stepZoom(zoom, dir));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, onZoom]);

  function timeAtPointer(e: PointerEvent) {
    let i = cols.current.findIndex(el => el && e.clientX < el.getBoundingClientRect().right);
    if (i < 0) i = days.length - 1;
    return timeAt(days[i], e.clientY - cols.current[i]!.getBoundingClientRect().top, hourPx);
  }
  function down(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement, block = target.closest<HTMLElement>('[data-id]'), t = timeAtPointer(e);
    if (block) {
      const it = entries.find(x => x.id === block.dataset.id);
      if (!it) return;
      drag.current = beginBoardDrag({ entry: it, edge: target.dataset.edge, copyKey: e.ctrlKey || e.altKey }, t, e.clientX, e.clientY, step);
    } else drag.current = beginBoardDrag(null, t, e.clientX, e.clientY, step);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const next = moveBoardDrag(d, timeAtPointer(e), e.clientX, e.clientY, now, step);
    drag.current = next.state;
    if (next.ghost) setGhost(next.ghost);
  }
  function up(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null; setGhost(null);
    if (!d) return;
    const act = endBoardDrag(d, e.clientX, e.clientY, now, step);
    if (act.type === 'open') onOpen(act.id, act.x, act.y);
    else if (act.type === 'create') onCreate(act.start, act.end, act.x, act.y);
    else if (act.type === 'copy') onCopy(act.id, act.start);
    else if (act.type === 'change') onChange(act.id, act.start, act.end);
  }

  const grid = { gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` };
  return <div className="cal-board">
    <div className="cal-head" style={grid}>
      <span className="cal-corner"><span className="k">{pad(boundaryHour)}:00</span></span>
      {days.map(day => { const d = new Date(day); return <span key={day} className={`cal-day${day === today ? ' today' : ''}`}>
        <b>{pad(d.getDate())}</b><span><i>{EN[d.getDay()]}</i>周{CN[d.getDay()]}</span><em>{hm(dayTotal(real, day, now))}</em></span>; })}
    </div>
    <div className="cal-scroll" ref={scroller} onScroll={event => { lastScrollTop.current = event.currentTarget.scrollTop; }}>
      <div className="cal-grid" style={{ ...grid, height: dayHeight(days[0], hourPx), '--hour-px': `${hourPx}px` } as CSSProperties}
        onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <div className="cal-hours">{Array.from({ length: 24 }, (_, i) => <span key={i} style={{ top: i * hourPx }}>{pad((i + boundaryHour) % 24)}:00</span>)}</div>
        {days.map((day, i) => <div key={day} className={`cal-col${day === today ? ' today' : ''}`} ref={el => { cols.current[i] = el; }}>
          {showIdle && idle.map(it => {
            const p = piece(Date.parse(it.started_at), it.ended_at === null ? now : Date.parse(it.ended_at), day, hourPx);
            return p && <div key={it.id} className="blk idle" style={{ top: p.top, height: p.height }} />;
          })}
          {layoutDay(real, day, now, hourPx).map(({ entry: it, top, height, col, cols: n }) => {
            const span = `${clock(Date.parse(it.started_at))}–${it.ended_at ? clock(Date.parse(it.ended_at)) : 'NOW'} · ${it.project}${it.card_id ? ' · 卡' : ''}`;
            return <div key={it.id} data-id={it.id} title={`${it.description}（${span}）`}
              className={`blk${it.ended_at === null ? ' running' : ''}${ghost?.id === it.id ? ' dim' : ''}${height <= 20 ? ' compact' : ''}`}
              style={{ top, height: Math.max(4, height), left: `calc(${col / n * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)`, '--c': colorOf(it.project) } as CSSProperties}>
              <i data-edge="top" />
              {height >= 12 && <span className="blk-t">{it.description}</span>}
              {height > 34 && <span className="blk-s">{span}</span>}
              {it.ended_at !== null && <i data-edge="bottom" />}
            </div>;
          })}
          {ghost && (() => { const p = piece(ghost.start, ghost.end, day, hourPx); return p && <div className="blk ghost" style={{ top: p.top, height: p.height }}>
            <span className="blk-s">{clock(ghost.start)}–{clock(ghost.end)}</span></div>; })()}
          {now >= day && now < day + 24 * 3_600_000 && <div className="cal-now" style={{ top: piece(day, now, day, hourPx)?.height ?? 0 }} />}
        </div>)}
      </div>
    </div>
  </div>;
}
