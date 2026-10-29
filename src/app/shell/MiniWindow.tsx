import type { ReactNode } from 'react';
import { MarkedText } from '../../ui/marks/MarkedText';
import { Icon } from '../../ui/icons/Icon';
import { Topo } from '../../ui/effects/Topo';
import { TagStrip } from '../../ui/marks/TagStrip';
import { MiniBars } from '../../ui/marks/VBars';
import './shell.css';

/**
 * 小窗的布局（UI 规范 §7.4、§11.9），纯展示：
 * - 普通小窗（mode = 'mini'，520×88）：左边标签条，中间浅色区（「记到 项目」小字、单行名称、30 格竖条），
 *   右边黑色计时块（状态英文小字、读数、暂停 / 继续、是卡时的完成、关闭）。
 * - 小小窗口（mode = 'tiny'，320×46）：去掉标签条、项目小字、进度竖条和状态英文，单行显示名称 + 读数 + 按钮。
 * 名称点一下就地变成透明输入框（titleInput）；读数 digits 由外面传（就地编辑的 TimeField）。空白处可以拖动窗口。
 */
export function MiniWindow({ mode = 'mini', strip, meta, title, titleInput, stateEn, digits, miniFilled, running, topoDepth, paused, canResume, onPause, onResume, onComplete, onClose, onTitle, caption }:
  { mode?: 'mini' | 'tiny'; strip: string; meta: ReactNode; title: string; titleInput?: ReactNode; stateEn: string; digits: ReactNode; miniFilled: number; running: boolean; topoDepth: number;
    paused: boolean; canResume: boolean; onPause: () => void; onResume: () => void; onComplete?: () => void; onClose: () => void; onTitle: () => void;
    caption?: ReactNode }) {
  const tiny = mode === 'tiny';
  return <div className={`mini-stack${tiny ? ' tiny' : ''}`}>
    <div className={`miniwin${tiny ? ' tiny' : ''}`} data-tauri-drag-region>
      {!tiny && <TagStrip mini no={strip} />}
      <div className="mini-l" data-tauri-drag-region>
        <Topo cell={8} alpha={.85} depth={topoDepth} running={running} />
        {!tiny && <span className="k mini-meta" data-tauri-drag-region>{meta}</span>}
        {titleInput ?? <button type="button" className="mini-title" title="点一下直接修改名称" onClick={onTitle}><b><MarkedText content={title} /></b></button>}
        {!tiny && <MiniBars filled={miniFilled} />}
      </div>
      <div className="mini-r" data-tauri-drag-region>
        <div className="mini-read">{!tiny && <span className="k">{stateEn}</span>}<span className="mini-time">{digits}</span></div>
        {paused
          ? <button type="button" className="mini-btn go" aria-label="继续" title="继续" disabled={!canResume} onClick={onResume}><Icon name="play" /></button>
          : <button type="button" className="mini-btn go" aria-label="暂停" title="暂停" onClick={onPause}><Icon name="pause" /></button>}
        {onComplete && <button type="button" className="mini-btn" aria-label="完成" title="完成：会打开主窗口填写「做到哪了」" onClick={onComplete}><Icon name="check" /></button>}
        <button type="button" className="mini-btn" aria-label="关闭小窗口" title="关闭小窗口" onClick={onClose}><Icon name="x" /></button>
      </div>
    </div>
    {caption && <span className="mini-cap">{caption}</span>}
  </div>;
}
