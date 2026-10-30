import type { CSSProperties, PointerEvent } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { dayHeight, dayTotal, dragTo, HOUR_PX, layoutDay, piece, snap, stepZoom, timeAt, zoomScrollTop } from './grid';
import type { CalZoom, DragKind, Span } from './grid';
import './calendar.css';

export interface CalEntry extends Span { description: string; project: string; card_id: string | null }

const MIN = 60_000, NEW_BLOCK = 30 * MIN;
const CN = ['日', '一', '二', '三', '四', '五', '六'], EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const pad = (n: number) => String(n).padStart(2, '0');
const clock = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const hm = (ms: number) => { const m = Math.round(ms / MIN); return `${Math.floor(m / 60)}h${pad(m % 60)}`; };

interface DragState { kind: DragKind | 'click'; id?: string; t0: number; start?: number; end?: number | null; x: number; y: number; moved: boolean; result?: { start: number; end: number | null } }

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
  const cols = useRef<(HTMLDivElement | null)[]>([]), scroller = useRef<HTMLDivElement>(null), drag = useRef<DragState | null>(null);
  const [ghost, setGhost] = useState<{ start: number; end: number; id: string | null } | null>(null);
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
      const start = Date.parse(it.started_at), end = it.ended_at === null ? null : Date.parse(it.ended_at), edge = target.dataset.edge;
      const kind = edge === 'top' ? 'top' : edge === 'bottom' && end !== null ? 'bottom' : end === null ? 'click' : e.ctrlKey || e.altKey ? 'copy' : 'move';
      drag.current = { kind, id: it.id, t0: t, start, end, x: e.clientX, y: e.clientY, moved: false };
    } else drag.current = { kind: 'create', t0: snap(t, step), x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientY - d.y) + Math.abs(e.clientX - d.x) > 4) d.moved = true;
    if (!d.moved || d.kind === 'click') return;
    d.result = dragTo({ kind: d.kind, t0: d.t0, start: d.start, end: d.end }, timeAtPointer(e), now, step);
    setGhost({ start: d.result.start, end: d.result.end ?? now, id: d.kind === 'copy' || d.kind === 'create' ? null : d.id! });
  }
  function up(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null; setGhost(null);
    if (!d) return;
    if (!d.moved || d.kind === 'click' || !d.result) {
      if (d.id) onOpen(d.id, e.clientX + 10, e.clientY + 10);
      else { const start = Math.min(d.t0, now - NEW_BLOCK); onCreate(start, start + NEW_BLOCK, e.clientX + 10, e.clientY + 10); }
      return;
    }
    const { start, end } = d.result;
    if (end !== null && end - start < step) return;
    if (d.kind === 'create') onCreate(start, end!, e.clientX + 10, e.clientY + 10);
    else if (d.kind === 'copy') onCopy(d.id!, start);
    else onChange(d.id!, start, end);
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
