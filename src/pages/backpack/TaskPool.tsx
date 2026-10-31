import type { KeyboardEvent } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../ui/controls/Button';
import { ProjectPicker } from '../../ui/controls/ProjectPicker';
import type { ProjectOption } from '../../ui/controls/ProjectPicker';
import { TextInput } from '../../ui/controls/TextInput';
import { Icon, Tri2 } from '../../ui/icons/Icon';
import { Group } from '../../ui/layout/GroupTitle';
import { plainText } from '../../ui/marks/MarkedText';
import { formatReadout } from '../../shared/duration';
import './taskpool.css';

/** 任务下面的一件事（一张卡）。content 带 [词] 标记。 */
export interface PoolItem {
  id: string; content: string; type: '结果卡' | '时间盒卡'; timeboxMinutes: number | null; elapsedMs: number; running: boolean;
  blocking: boolean; dueAt: string | null; shrinkLevel: number; project: string | null; tags: string[];
}
export interface PoolTask { id: string; name: string; track: '主线' | '支线'; items: PoolItem[]; defaultProject: string; overLimit?: boolean }
export interface ParkedTask { id: string; name: string; track: '主线' | '支线'; itemCount: number }
export interface PoolView {
  mains: PoolTask[]; sides: PoolTask[]; parked: ParkedTask[]; doneSides: string[];
  /** 三个上限：主线任务数、支线任务数、每个主线任务下的事项数。 */
  mainMax: number; sideMax: number; mainItems: number;
  projects: ProjectOption[];
  /** E4：支线满了时用记录条存的待办照常保存，超出上限的这几个支线任务要标出来。 */
  excessSideIds?: string[];
}
export interface PoolActions {
  newTask: (track: '主线' | '支线') => void;
  editItem: (itemId: string) => void;
  startItem: (itemId: string) => void;
  addItem: (taskId: string, content: string) => void;
  setDefaultProject: (taskId: string, project: string) => void;
  freeze: (taskId: string) => void;
  abandon: (taskId: string) => void;
  restore: (taskId: string, track: '主线' | '支线') => void;
  createProject: (name: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (ms: number) => formatReadout(ms, 'mmss');
const when = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** 只有一项、而且这一项就是任务本身的：合成一行，点标题编辑这件事。 */
export const isSingle = (t: PoolTask) => t.items.length === 1 && plainText(t.items[0].content) === t.name;

function Meta({ item }: { item: PoolItem }) {
  return <small className="qc-meta">
    {item.blocking && <span className="tag-block">BLOCK</span>}
    {item.running && <span className="run">进行中</span>}
    <span>{item.type === '时间盒卡' ? `时间盒 ${item.timeboxMinutes} 分` : '结果卡'}</span><span>已用 {clock(item.elapsedMs)}</span>
    {item.dueAt && <span>{when(item.dueAt)} 到期</span>}
    {item.shrinkLevel > 0 && <span>缩小 {item.shrinkLevel} 级</span>}
    {item.project && <span>记到 {item.project}</span>}
    {item.tags.map(t => <span key={t}>#{t}</span>)}
  </small>;
}

/**
 * 判断卡片右下角下拉菜单是否应向上弹出：
 * 综合窗口视口与最近可滚动/裁切祖先（如 .s-panel）的可视上下边界，以及菜单实际高度（+ 4px 间距）。
 * 当下方可视空间不足以容纳菜单、且上方可视空间更充裕或足以容纳时，返回 true（向上弹出）。
 */
export function shouldOpenMenuUp(
  triggerRect: { top: number; bottom: number },
  menuHeight: number,
  viewportHeight: number,
  clipBounds?: { top: number; bottom: number } | null,
): boolean {
  const topBound = clipBounds ? Math.max(0, clipBounds.top) : 0;
  const bottomBound = clipBounds ? Math.min(viewportHeight, clipBounds.bottom) : viewportHeight;
  const need = menuHeight + 4;
  const spaceBelow = bottomBound - triggerRect.bottom;
  const spaceAbove = triggerRect.top - topBound;
  return spaceBelow < need && (spaceAbove >= need || spaceAbove > spaceBelow);
}

function findClipAncestor(el: HTMLElement | null): HTMLElement | null {
  for (let cur = el?.parentElement ?? null; cur && cur !== document.body; cur = cur.parentElement) {
    if (cur.classList?.contains('s-panel') || cur.classList?.contains('pg')) return cur;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      const { overflowY } = window.getComputedStyle(cur);
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden' || overflowY === 'clip') return cur;
    }
  }
  return null;
}

/** 任务卡牌：左边竖条标主 / 支，中间是事项，底下一行「计时记到」，右下角双向下箭头展开操作菜单。 */
function QuestCard({ task, mainItems, projects, excess, actions }: { task: PoolTask; mainItems: number; projects: ProjectOption[]; excess: boolean; actions: PoolActions }) {
  const [confirm, setConfirm] = useState(false), [adding, setAdding] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false), [menuUp, setMenuUp] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null), popRef = useRef<HTMLDivElement>(null);
  const main = task.track === '主线', one = isSingle(task), room = main ? mainItems - task.items.length : Infinity;
  useLayoutEffect(() => {
    if (!menuOpen || !menuRef.current || !popRef.current) return;
    const clipEl = findClipAncestor(menuRef.current);
    const updatePlacement = () => {
      if (!menuRef.current || !popRef.current) return;
      const triggerRect = menuRef.current.getBoundingClientRect();
      const menuHeight = popRef.current.getBoundingClientRect().height;
      const clipRect = clipEl?.getBoundingClientRect() ?? null;
      setMenuUp(shouldOpenMenuUp(triggerRect, menuHeight, window.innerHeight, clipRect));
    };
    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    clipEl?.addEventListener('scroll', updatePlacement, { passive: true });
    return () => {
      window.removeEventListener('resize', updatePlacement);
      clipEl?.removeEventListener('scroll', updatePlacement);
    };
  }, [menuOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [menuOpen]);
  const toggleMenu = () => setMenuOpen(o => !o);
  const add = () => { if (adding?.trim()) actions.addItem(task.id, adding.trim()); setAdding(null); };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') add();
    if (e.key === 'Escape') setAdding(null);
  };
  return <article className={`qc ${main ? 'main' : 'side'}${excess ? ' excess' : ''}${menuOpen ? ' menu-open' : ''}`} aria-label={`${task.track}任务：${task.name}`}>
    <div className="qc-strip" aria-hidden="true"><span className="vt-t">{main ? 'MAIN' : 'SIDE'}</span><b>{main ? '主' : '支'}</b><Tri2 /><i className="vt-hatch" /></div>
    <div className="qc-body">
      <div className="qc-top"><span className="k">{main ? 'MAIN QUEST' : 'SIDE QUEST'}</span>
        {main && <span className={`qc-cnt${room <= 0 ? ' full' : ''}`}>{pad(task.items.length)}<small>/{pad(mainItems)}</small></span>}</div>
      {one
        ? <><h4 className="qc-title click" title="点一下编辑这件事" onClick={() => actions.editItem(task.items[0].id)}>{task.name}</h4>
          <div className="qc-single-row"><Meta item={task.items[0]} />
            <Button size="sm" disabled={task.items[0].running} onClick={() => actions.startItem(task.items[0].id)}>{task.items[0].running ? '进行中' : '开始'}</Button></div></>
        : <><h4 className="qc-title">{task.name}</h4>
          <ul className="qc-items">
            {task.items.map(item => <li key={item.id} className="qc-item-row"><button type="button" className="qc-item" title="点一下编辑" onClick={() => actions.editItem(item.id)}>
              <i /><span>{plainText(item.content)}</span><Meta item={item} /></button>
              <Button size="sm" disabled={item.running} onClick={() => actions.startItem(item.id)}>{item.running ? '进行中' : '开始'}</Button></li>)}
            {task.items.length === 0 && <li className="qc-empty">没有待做的事项了，加一项吧</li>}
          </ul></>}
      {excess && <p className="qc-over">超出支线上限：先做完、冷藏或放弃一个支线任务</p>}
      {adding !== null && <div className="qc-add">
        <TextInput autoFocus aria-label="新的一件事" value={adding} placeholder={one ? '拆成具体的一件事' : '再加一件事'} onChange={e => setAdding(e.target.value)} onKeyDown={keys} />
        <Button size="sm" tone="ink" disabled={!adding.trim()} onClick={add}>加上</Button></div>}
      <div className="qc-proj"><span className="k">LOG TO</span>
        <div className="qc-proj-r">
          <ProjectPicker small value={task.defaultProject} options={projects} onChange={v => actions.setDefaultProject(task.id, v)} onCreate={actions.createProject} />
          <div className="qc-menu" ref={menuRef}>
            <Button size="sm" className="qc-menu-btn" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="任务操作" title="任务操作" onClick={toggleMenu}>
              <Tri2 />
            </Button>
            {menuOpen && <div ref={popRef} className={`qc-menu-pop${menuUp ? ' up' : ''}`} role="menu">
              {/* 只有一项的第一次拆开是替换那一项，不占位置，满了也能拆 */}
              <button type="button" role="menuitem" disabled={room <= 0 && !one}
                title={room <= 0 && !one ? `每个主线任务下最多 ${mainItems} 项` : '在这个任务下面加一件事'}
                onClick={() => { setMenuOpen(false); setAdding(''); }}>{one ? '拆分任务' : '添加任务'}</button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); actions.freeze(task.id); }}>冷藏</button>
              <button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); setConfirm(true); }}>放弃</button>
            </div>}
          </div>
        </div>
      </div>
      {confirm && <div className="ls-warn">放弃后，下面待做的 {task.items.length} 项全部作废；正在计时的会停下。暂时不做就用「冷藏」。
        <div className="qc-confirm"><Button size="sm" tone="danger" onClick={() => { actions.abandon(task.id); setConfirm(false); }}>确认放弃</Button>
          <Button size="sm" onClick={() => setConfirm(false)}>算了</Button></div></div>}
    </div>
  </article>;
}

const NewTile = ({ text, en, onClick }: { text: string; en: string; onClick: () => void }) =>
  <button type="button" className="qc new" onClick={onClick}><span className="qi"><Icon name="plus" /></span><b>{text}</b><i>{en}</i></button>;

/**
 * 背包的任务池（方案 §7.5，原型 backpack.js 的 PoolPanel）：主线任务、支线任务做成卡牌，下面是冷藏的。
 * 只有一项、而且就是任务本身的合成一行；第一次「拆开」时，那一项由逻辑线换成拆出来的事。新建任务、编辑事项的对话框由页面打开。
 */
export function TaskPool({ view, actions }: { view: PoolView; actions: PoolActions }) {
  const { mains, sides, parked, doneSides, mainMax, sideMax, mainItems, projects, excessSideIds = [] } = view;
  const free = { 主线: mains.length < mainMax, 支线: sides.length < sideMax };
  const card = (t: PoolTask) => <QuestCard key={t.id} task={t} mainItems={mainItems} projects={projects} excess={excessSideIds.includes(t.id)} actions={actions} />;
  return <>
    <Group cn="主线任务" en="MAIN QUEST" right={`${mains.length} / ${mainMax} 个 · 每个最多 ${mainItems} 项`}>
      <div className="qc-grid">{mains.map(card)}
        {free.主线 && <NewTile text={mains.length ? '再设一个主线任务' : '设定主线任务'} en="NEW MAIN" onClick={() => actions.newTask('主线')} />}</div>
      {mains.length === 0 && <p className="ls-empty">没有主线时首页照常出卡，只是卡角会提示一句。</p>}
    </Group>
    <Group cn="支线任务" en="SIDE QUEST" right={`${sides.length} / ${sideMax} 个`}>
      <div className="qc-grid">{sides.map(card)}
        {free.支线 && <NewTile text="新建支线任务" en="NEW SIDE" onClick={() => actions.newTask('支线')} />}</div>
      <p className="ls-empty">{free.支线 ? '普通待办也是支线任务；快速记录条里选「待办」存下的，也会进到这里。' : '支线任务满了：先做完、冷藏或放弃一个。'}</p>
    </Group>
    <Group cn="冷藏" en="PARKED">
      {parked.length === 0 ? <p className="ls-empty">没有冷藏的任务。</p>
        : <ul className="ls">{parked.map(t => <li key={t.id} className="ls-item">
          <div><b>{t.name}</b><div className="ls-meta"><span>{t.track}任务 · 冷藏中</span><span>{t.itemCount} 项待做</span></div></div>
          <div className="ls-acts">{(['主线', '支线'] as const).map(s => <Button key={s} size="sm" disabled={!free[s]} onClick={() => actions.restore(t.id, s)}>
            放回为{s}{free[s] ? '' : '（满）'}</Button>)}</div></li>)}</ul>}
      {doneSides.length > 0 && <p className="ls-empty">已完成的支线任务：{doneSides.join('、')}</p>}
    </Group>
  </>;
}
