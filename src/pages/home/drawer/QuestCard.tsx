import { useState } from 'react';
import type { PoolItem, PoolTask } from '../../../store/backpackSlice';
import type { PlanBoard } from '../../../store/planSlice';
import { Icon } from '../../../ui/icons/Icon';
import { plainText } from '../../../ui/marks/MarkedText';
import { hm } from './TodayBoard';
import type { PlanDay } from './TodayBoard';

const minutesOf = (it: PoolItem) => it.elapsedMs / 60_000;
/** 那天到期：卡的期限落在今天 / 明天的活动日（投影按换日时间算好 dueDay）。 */
export function dueLabel(it: PoolItem, days: { today: string; tomorrow: string }): string {
  const d = it.dueDay ?? null;
  return d === days.today ? '今天到期' : d === days.tomorrow ? '明天到期' : '';
}
export function onBoard(board: PlanBoard, cardId: string) { return board.rows.some(r => r.cardId === cardId); }

/** 进度条：一项一段；做完的墨色，时间盒按已计 / 目标涂强调色，正在计的那段墨框。 */
export function Progress({ task, big }: { task: PoolTask; big?: boolean }) {
  const all = [...(task.doneItems ?? []), ...task.items];
  return <div className={`bp-prog${big ? ' big' : ''}`} aria-hidden="true">{all.map(it => it.done
    ? <i key={it.id} className="done" />
    : <i key={it.id} className={it.running ? 'run' : undefined}>{it.type === '时间盒卡' && it.timeboxMinutes ? <b style={{ width: `${Math.min(100, minutesOf(it) / it.timeboxMinutes * 100)}%` }} /> : null}</i>)}</div>;
}
export function ProgressLine({ task }: { task: PoolTask }) {
  const all = [...(task.doneItems ?? []), ...task.items], done = task.doneItems?.length ?? 0;
  const spent = all.reduce((n, it) => n + minutesOf(it), 0), goal = all.filter(it => it.type === '时间盒卡').reduce((n, it) => n + (it.timeboxMinutes ?? 0), 0);
  return <div className="bp-pline">{all.length > 1 && <span><b>{done}/{all.length}</b> 项</span>}
    {goal ? <span>计时 <b>{hm(spent)}</b> / {hm(goal)}</span> : <span>已用 <b>{hm(spent)}</b></span>}</div>;
}
export function PlanButton({ item, day, board, onPlan, onUnplan }:
  { item: PoolItem; day: PlanDay; board: PlanBoard; onPlan: (item: PoolItem, anchor: HTMLElement) => void; onUnplan: (cardId: string) => void }) {
  const word = day === 'today' ? '今天' : '明天';
  return onBoard(board, item.id)
    ? <button type="button" className="bp-btn on" title={`点一下移出${word}`} onClick={e => { e.stopPropagation(); onUnplan(item.id); }}>{word}已排 ✓</button>
    : <button type="button" className="bp-btn" onClick={e => { e.stopPropagation(); onPlan(item, e.currentTarget); }}>排进{word}</button>;
}

/**
 * 背包里的任务卡（便签，UI 规范 §11.15）：主线 / 支线、名字、进度、下一项；〔排进今天〕只排下一项（已定 53），〔▶ 开始〕、〔详情 ›〕。
 * 整张可点 = 详情。只有一件事的任务不列「下一项」。
 */
export function QuestCard({ task, day, board, days, inserting, onOpen, onPlan, onUnplan, onStart }:
  { task: PoolTask; day: PlanDay; board: PlanBoard; days: { today: string; tomorrow: string }; inserting: boolean;
    onOpen: () => void; onPlan: (item: PoolItem, anchor: HTMLElement) => void; onUnplan: (cardId: string) => void; onStart: (cardId: string) => void }) {
  const main = task.track === '主线', next = task.items[0], one = task.items.length + (task.doneItems?.length ?? 0) === 1;
  const running = task.items.some(it => it.running), due = next ? dueLabel(next, days) : '';
  return <article className={`bq${main ? ' main' : ''}${running ? ' run' : ''}`} tabIndex={0} onClick={onOpen}
    onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(); }}>
    <div className="bq-body">
      <div className="bq-top"><span className="bq-chip">{main ? '主线' : '支线'}</span><span className="k">{main ? 'MAIN QUEST' : 'SIDE QUEST'}</span>
        {running ? <span className="r run">进行中</span> : main && task.betEndsAt ? <span className="r">押注到 {task.betEndsAt.slice(5).replace('-', '/')}</span> : null}</div>
      <h4 className="bq-title">{task.name}</h4>
      <Progress task={task} /><ProgressLine task={task} />
      {next && !one && <div className="bp-next"><span className="k">NEXT · 下一项</span><span>{plainText(next.content)}</span>
        <small>{next.type === '时间盒卡' ? `时间盒 ${hm(minutesOf(next))} / ${hm(next.timeboxMinutes ?? 0)}` : '结果卡'}{due && <> · <b className="bp-due">{due}</b></>}</small></div>}
      {next && one && due && <div className="bp-pline"><b className="bp-due">{due}</b></div>}
    </div>
    <footer className="bq-acts">
      {next && <PlanButton item={next} day={day} board={board} onPlan={onPlan} onUnplan={onUnplan} />}
      {next && !next.running && <button type="button" className="bp-go" disabled={inserting} title={inserting ? '插入中不能开始别的卡，先回到任务' : undefined}
        onClick={e => { e.stopPropagation(); onStart(next.id); }}><Icon name="play" />开始</button>}
      <button type="button" className="bp-more" onClick={e => { e.stopPropagation(); onOpen(); }}>详情 ›</button>
    </footer>
  </article>;
}

/** 任务详情（UI 规范 §11.15）：每项一行，做完的灰显留着；支持单子项完成/取消完成与底部整张任务完成/重开。 */
export function QuestDetail({ task, day, board, days, inserting, mainItems = 5,
  completeTaskBlocked, reopenTaskBlocked, completeItemBlocked, reopenItemBlocked,
  onBack, onEdit, onPlan, onUnplan, onStart, onAdd, onCompleteItem, onReopenItem, onCompleteTask, onReopenTask, onFreeze, onAbandon }:
  { task: PoolTask; day: PlanDay; board: PlanBoard; days: { today: string; tomorrow: string }; inserting: boolean; mainItems?: number;
    completeTaskBlocked?: string | null; reopenTaskBlocked?: string | null;
    completeItemBlocked?: (item: PoolItem) => string | null; reopenItemBlocked?: (item: PoolItem) => string | null;
    onBack: () => void; onEdit: (cardId: string) => void; onPlan: (item: PoolItem, anchor: HTMLElement) => void; onUnplan: (cardId: string) => void;
    onStart: (cardId: string) => void; onAdd: (content: string) => void;
    onCompleteItem: (item: PoolItem) => void; onReopenItem: (item: PoolItem) => void;
    onCompleteTask: () => void; onReopenTask: () => void;
    onFreeze: () => void; onAbandon: () => void }) {
  const [adding, setAdding] = useState(false), [text, setText] = useState('');
  const main = task.track === '主线', completed = task.status === '已完成';
  const addBlocked = main && task.items.length >= mainItems ? `主线任务最多同时有 ${mainItems} 个待做子任务` : null;
  const row = (it: PoolItem) => {
    const done = !!it.done, due = dueLabel(it, days), spent = minutesOf(it);
    const itemCompleteErr = !done ? completeItemBlocked?.(it) ?? null : null;
    const itemReopenErr = done ? reopenItemBlocked?.(it) ?? null : null;
    const stDisabled = done ? Boolean(itemReopenErr) : Boolean(itemCompleteErr);
    const stTitle = done
      ? (itemReopenErr ?? (completed ? '取消完成：将任务与这一项一并恢复回背包' : '取消完成，恢复为待做'))
      : (itemCompleteErr ?? '完成这一项');
    const meta = done ? `完成 · ${it.done!.slice(5).replace('-', '/')} · 用时 ${hm(spent)}`
      : `${it.type === '时间盒卡' ? '时间盒' : '结果卡'} · 记到 ${it.project ?? task.defaultProject}${it.tags.length ? ' · ' + it.tags.map(t => '#' + t).join(' ') : ''}`;
    return <li key={it.id} className={`bp-it${done ? ' done' : ''}${it.running ? ' run' : ''}${it.split ? ` split-${it.split}` : ''}`}
      title={it.splitFrom ? `从「${plainText(it.splitFrom)}」缩小来的` : done || completed ? undefined : '点一下编辑'} onClick={done || completed ? undefined : () => onEdit(it.id)}>
      <button type="button" className="st" disabled={stDisabled} title={stTitle}
        aria-label={`${done ? '取消完成子任务：' : '完成子任务：'}${plainText(it.content)}`}
        onClick={e => { e.stopPropagation(); if (done) onReopenItem(it); else onCompleteItem(it); }}>
        {done ? <Icon name="check" /> : it.running ? <Icon name="play" /> : null}
      </button>
      <span className="t"><span>{plainText(it.content)}</span><small>{it.split && <span className="lv">SHRINK</span>}{meta}{due && !done && <> · <b className="bp-due">{due}</b></>}</small></span>
      <span className="pr">{it.type === '时间盒卡' && it.timeboxMinutes
        ? <><span className="pb"><i style={{ width: `${Math.min(100, spent / it.timeboxMinutes * 100)}%` }} /></span><b>{hm(spent)} / {hm(it.timeboxMinutes)}</b></>
        : <b>{done ? hm(spent) : '—'}</b>}</span>
      <span className="acts" onClick={e => e.stopPropagation()}>{!done ? <>
        {!completed && <PlanButton item={it} day={day} board={board} onPlan={onPlan} onUnplan={onUnplan} />}
        {!completed && (it.running ? <span className="bq-top"><span className="r run">进行中</span></span>
          : <button type="button" className="bp-go" disabled={inserting} title={inserting ? '插入中不能开始别的卡，先回到任务' : undefined} onClick={() => onStart(it.id)}><Icon name="play" />开始</button>)}
        <button type="button" className="bp-btn" disabled={Boolean(itemCompleteErr)} title={itemCompleteErr ?? '完成这一项'}
          aria-label={`完成子任务：${plainText(it.content)}`} onClick={() => onCompleteItem(it)}>完成</button>
      </> : <button type="button" className="bp-btn" disabled={Boolean(itemReopenErr)}
        title={itemReopenErr ?? (completed ? '取消完成：将任务与这一项一并恢复回背包' : '取消完成，恢复为待做')}
        aria-label={`取消完成子任务：${plainText(it.content)}`} onClick={() => onReopenItem(it)}>取消完成</button>}</span>
    </li>;
  };
  const submit = () => { const v = text.trim(); if (v) onAdd(v); setText(''); setAdding(false); };
  return <>
    <div className="bp-dhead"><button type="button" className="bp-backlink" onClick={onBack}><Icon name="back" />{completed ? '背包 · 已完成' : '背包 · 任务'}</button>
      <span className="bp-hint">{completed ? '已完成任务详情 · 点某一项「取消完成」可将该任务与该子项一并恢复 · Esc 回到列表' : '点一项 = 编辑 · 点左侧方框或右侧按钮完成/取消完成子项 · Esc 回到背包'}</span></div>
    <article className={`bp-detail${main ? ' main' : ''}`}>
      <div className="bp-dtop"><span className="bq-top"><span className="bq-chip">{main ? '主线' : '支线'}</span>
        <span className="k">{main ? 'MAIN QUEST' : 'SIDE QUEST'}{main && task.betEndsAt ? ` · 押注到 ${task.betEndsAt.slice(5).replace('-', '/')}` : ''}{completed ? ' · 已完成' : ''}</span></span>
        <h3>{task.name}</h3><Progress task={task} big /><ProgressLine task={task} /></div>
      <ul className="bp-items">{[...(task.doneItems ?? []), ...task.items].map(row)}</ul>
      <div className="bp-dfoot">
        {!completed && (adding ? <span className="add"><input autoFocus value={text} placeholder="新子任务，回车加上（结果卡）" onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); } }} />
            <button type="button" className="bp-btn" onClick={submit}>加上</button></span>
          : <button type="button" className="bp-btn" disabled={Boolean(addBlocked)} title={addBlocked ?? undefined} onClick={() => setAdding(true)}>＋ 添加子任务</button>)}
        {completed && <span className="bp-hint">{task.reopenMode === 'snapshot'
          ? `整张重新打开将恢复本批 ${task.reopenCardIds?.length ?? 0} 项`
          : task.reopenMode === 'task_only'
            ? '无批量快照：整张重新打开只把任务放回背包，已完成子项保持完成'
            : '快照与当前子项冲突，可单独取消完成上方子项'}</span>}
        <span className="grow" /><span className="bp-logto"><span className="k">LOG TO</span>计时记到 {task.defaultProject}</span>
        {completed
          ? <button type="button" className="bp-btn ok" disabled={Boolean(reopenTaskBlocked)} title={reopenTaskBlocked ?? undefined} onClick={onReopenTask}>重新打开整张任务</button>
          : <>
              <button type="button" className="bp-btn ok" disabled={Boolean(completeTaskBlocked)} title={completeTaskBlocked ?? undefined} onClick={onCompleteTask}>✓ 完成整张任务</button>
              <button type="button" className="bp-btn" disabled={Boolean(completeTaskBlocked)} title={completeTaskBlocked ?? undefined} onClick={onFreeze}>冷藏</button>
              <button type="button" className="bp-btn danger" disabled={Boolean(completeTaskBlocked)} title={completeTaskBlocked ?? undefined} onClick={onAbandon}>放弃</button>
            </>}
      </div>
    </article>
  </>;
}
