import { useStore } from 'zustand';
import { appStore } from '../../store/appStore';
import { Icon } from '../../ui/icons/Icon';
import { plainText } from '../../ui/marks/MarkedText';
import './shell.css';

/**
 * 底栏〔背包〕（UI 规范 §11.15）：数字段写「今日 1/5」（达成 / 板子上的项），今天没排写「今日未排」；打开时箭头块转 180° 变强调色。
 * 插入期间多一个黑底〔↩ 名字 等你回来〕（§11.14 底栏），点了等于〔回到任务〕；在日历、列表页也看得到。
 */
export function BagToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const board = useStore(appStore, s => s.plan.today), taskMode = useStore(appStore, s => s.settings.taskMode);
  return <button type="button" className="dock-toggle bp-bag" aria-expanded={open} title="背包：今日任务板、任务、想法池（B）" onClick={onToggle}>
    <span className="chev"><Icon name="chev" /></span><span className="t-cn">背包</span>
    {taskMode && <span className="cnt">{board.total ? <>今日 <b>{board.achieved}</b>/{board.total}</> : '今日未排'}</span>}
  </button>;
}
export function WaitingChip({ onBack }: { onBack: () => void }) {
  const insert = useStore(appStore, s => s.home.insert);
  if (!insert) return null;
  const o = insert.over, title = plainText(o.kind === 'card' ? o.title : o.title), short = title.length > 14 ? title.slice(0, 13) + '…' : title;
  return <button type="button" className="ins-chip" title={o.kind === 'card' ? `回到「${title}」，接着计` : `回到「${title}」`} onClick={onBack}>
    <span className="chev"><Icon name="back" /></span><span>{short} 等你回来</span>
  </button>;
}
