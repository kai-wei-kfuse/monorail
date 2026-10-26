import type { TaskCardView } from '../../pages/home/TaskCard';
import { parseMarks } from '../../pages/home/title';
import { formatMinutes } from '../../widgets/cardProgress';
import { Icon } from '../../ui/icons/Icon';
import { Topo } from '../../ui/effects/Topo';
import { TagStrip } from '../../ui/marks/TagStrip';
import { MiniBars } from '../../ui/marks/VBars';
import './shell.css';

const STATE_EN = { ready: 'READY', run: 'RUNNING', away: 'AWAY', over: 'OVERTIME' } as const;

/**
 * 悬浮小窗 520×88（§7.4）：左边 24px 标签条，中间浅色区（等高线、项目和类型小字、单行标题、30 格竖条），右边黑色计时块。
 * 按钮是「开始 / 完成」和「还原」。在小窗里点完成，由调用方先还原主窗口再弹完成对话框（架构 §5.5）。
 */
export function MiniWindow({ view, running, topoDepth, onPrimary, onRestore }:
  { view: TaskCardView; running: boolean; topoDepth: number; onPrimary: (at: string) => void; onRestore: () => void }) {
  const { progress } = view;
  const meta = [view.project, view.type === '时间盒卡' ? '时间盒' : '结果卡', view.goalMinutes !== null ? `目标 ${view.goalMinutes} 分钟` : null].filter(Boolean).join(' · ');
  return <div className="miniwin" data-tauri-drag-region>
    <TagStrip mini no={view.slotNo} />
    <div className="mini-l" data-tauri-drag-region>
      <Topo cell={8} alpha={.85} depth={topoDepth} running={running} />
      <span className="k">{meta}</span>
      <b>{parseMarks(view.content).map((p, i) => p.mark ? <span key={i} className="hl">{p.text}</span> : p.text)}</b>
      <MiniBars filled={progress.miniFilled} />
    </div>
    <div className="mini-r">
      <div className="mini-read">
        <span className="k">{progress.overMs > 0 ? `+${formatMinutes(progress.overMs)}` : STATE_EN[progress.state]}</span>
        <span className="mini-time">{formatMinutes(view.elapsedMs)}</span>
      </div>
      <button type="button" className="mini-btn go" aria-label={running ? '完成' : '开始'} title={running ? '完成' : '开始'}
        onClick={() => onPrimary(new Date().toISOString())}><Icon name={running ? 'check' : 'play'} /></button>
      <button type="button" className="mini-btn" aria-label="还原主窗口" title="还原主窗口" onClick={onRestore}><Icon name="expand" /></button>
    </div>
  </div>;
}
