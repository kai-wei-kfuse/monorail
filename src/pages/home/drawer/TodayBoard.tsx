import type { PlanBoard, PlanRow } from '../../../store/planSlice';
import { Icon } from '../../../ui/icons/Icon';
import { Segmented } from '../../../ui/controls/Segmented';
import { Button } from '../../../ui/controls/Button';
import { plainText } from '../../../ui/marks/MarkedText';

export type PlanDay = 'today' | 'tomorrow';
const pad = (n: number) => String(n).padStart(2, '0');
export const hm = (minutes: number) => `${Math.floor(minutes / 60)}:${pad(Math.floor(minutes) % 60)}`;

/**
 * 今日任务板（UI 规范 §11.15 左栏）：〔今天 | 明天〕、每行状态方框 / 名字 / 进度 / 「高」；鼠标放上去出〔开始〕〔移出〕。
 * 今天的板子底部〔抽一张〕：插入中、全部达成、没有可抽的项时灰掉。明天的板子不能抽。
 * 带过来、还没确认的（已定 4）：板子顶上一条确认，〔都带上〕〔不带〕；确认前这些行不参与抽卡。
 */
export function TodayBoard({ day, board, drawable, inserting, runningMs, onDay, onStart, onRemove, onDraw, onCarry }:
  { day: PlanDay; board: PlanBoard; drawable: number; inserting: boolean;
    /** 正在计那一行：提交后又过去的毫秒（读数按秒补） */ runningMs: number;
    onDay: (day: PlanDay) => void; onStart: (cardId: string) => void; onRemove: (cardId: string) => void;
    onDraw: () => void; onCarry: (keep: string[]) => void }) {
  const today = day === 'today', rows = board.rows;
  const carried = today && board.carryPending ? rows.filter(r => r.carried) : [];
  const canDraw = today && !inserting && (rows.length === 0 || (drawable > 0 && board.achieved < board.total));
  return <section className="bp-board" aria-label={today ? '今日任务板' : '明日任务板'}>
    <div className="bp-bhead">
      <div className="bp-btitle"><b>{today ? '今日任务板' : '明日任务板'}</b>
        <span className="n">{today ? <>{pad(board.achieved)}<small>/{pad(board.total)}</small></> : <>{pad(board.total)}<small> 项</small></>}</span></div>
      <Segmented label="哪一天" value={day} onChange={onDay} options={[{ value: 'today', label: '今天' }, { value: 'tomorrow', label: '明天' }]} />
    </div>
    {carried.length > 0 && <div className="bp-carry" role="region" aria-label="带过来的">
      <b>从{board.carriedFrom ? ` ${board.carriedFrom.slice(5).replace('-', '/')} ` : '前一天'}带过来 {carried.length} 项</b>
      <span>没做完的带到了今天。确认前它们不参与抽卡。</span>
      <span className="acts"><Button size="sm" onClick={() => onCarry([])}>不带</Button><Button size="sm" tone="ink" onClick={() => onCarry(carried.map(r => r.cardId))}>都带上</Button></span>
    </div>}
    {rows.length ? <ul className="bp-list">{rows.map(r => <Row key={r.cardId} row={r} today={today} runningMs={runningMs} inserting={inserting} onStart={onStart} onRemove={onRemove} />)}</ul>
      : <div className="bp-empty"><b>{today ? '今天还没排' : '明天还没排'}</b>从右边的任务卡点〔{today ? '排进今天' : '排进明天'}〕，或者在详情里逐项排。</div>}
    <div className="bp-bfoot">{today
      ? <><button type="button" className="bp-draw" disabled={!canDraw} onClick={onDraw} title={inserting ? '插入中不能抽卡，先回到任务' : undefined}>
            <span className="lbl"><b>抽一张</b><i>DRAW FROM TODAY</i></span><span className="bp-stack" aria-hidden="true"><i /><i /><i /></span></button>
          <span className="bp-hint">{inserting ? '插入中不能抽卡，先回到任务。' : rows.length ? `从板子上没达成的 ${drawable} 项里抽，标「高」的抽到概率更高。` : '今天没排时会先问你要不要排。'}</span></>
      : <span className="bp-hint">明天的板子只能排，不能抽。过了换日时间，它就是今天的板子；今天没做完的会让你确认带不带。</span>}</div>
  </section>;
}

function Row({ row: r, today, runningMs, inserting, onStart, onRemove }:
  { row: PlanRow; today: boolean; runningMs: number; inserting: boolean; onStart: (cardId: string) => void; onRemove: (cardId: string) => void }) {
  const name = r.taskName ? `${r.taskName}：${plainText(r.title)}` : plainText(r.title);
  const spent = r.minutesToday + (r.running ? runningMs / 60_000 : 0);
  const due = r.dueThatDay ? <span className="due">{today ? '今天到期' : '明天到期'}</span> : null;
  return <li className={`bp-row${r.running ? ' run' : ''}${r.achieved ? ' done' : ''}`}>
    <span className="st">{r.achieved ? <Icon name="check" /> : r.running ? <Icon name="play" /> : null}</span>
    <span className="t" title={name}><em>{r.track === '主线' ? 'MAIN' : 'SIDE'}</em>{name}</span>
    {r.priority === '高' ? <span className="pri">高</span> : <span />}
    <span className="sub">{r.achieved
      ? (r.type === '时间盒卡' ? <><b>{hm(spent)}</b><span>今日达成</span></> : <span>已完成</span>)
      : r.type === '时间盒卡' && r.todayMinutes !== null
        ? <><span className="pb"><i style={{ width: `${Math.min(100, spent / r.todayMinutes * 100)}%` }} /></span><b>{hm(spent)} / {hm(r.todayMinutes)}</b>{due}</>
        : <><span>完成条件</span>{due}</>}</span>
    <span className="acts">
      {today && !r.achieved && !r.running && <button type="button" disabled={inserting} onClick={() => onStart(r.cardId)}>开始</button>}
      <button type="button" title={`移出${today ? '今天' : '明天'}`} onClick={() => onRemove(r.cardId)}>移出</button>
    </span>
  </li>;
}
