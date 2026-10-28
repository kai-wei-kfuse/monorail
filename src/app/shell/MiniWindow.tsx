import type { ReactNode } from 'react';
import { MarkedText } from '../../ui/marks/MarkedText';
import { Icon } from '../../ui/icons/Icon';
import { Topo } from '../../ui/effects/Topo';
import { TagStrip } from '../../ui/marks/TagStrip';
import { MiniBars } from '../../ui/marks/VBars';
import './shell.css';

/**
 * 小窗的布局（UI 规范 §7.4、§11.9），纯展示：左边标签条，中间浅色区（「记到 项目」小字、单行名称、30 格竖条），
 * 右边黑色计时块（状态英文小字、读数、暂停 / 继续、是卡时的完成、关闭）。下面是编辑面板（打开时）和一条说明。
 * 名称是按钮，点了打开编辑面板；读数 digits 由外面传（就地编辑的 TimeField）。空白处可以拖动窗口。
 */
export function MiniWindow({ strip, meta, title, stateEn, digits, miniFilled, running, topoDepth, paused, canResume, onPause, onResume, onComplete, onClose, onTitle, editor, caption }:
  { strip: string; meta: string; title: string; stateEn: string; digits: ReactNode; miniFilled: number; running: boolean; topoDepth: number;
    paused: boolean; canResume: boolean; onPause: () => void; onResume: () => void; onComplete?: () => void; onClose: () => void; onTitle: () => void;
    editor?: ReactNode; caption: ReactNode }) {
  return <div className="mini-stack">
    <div className="miniwin" data-tauri-drag-region>
      <TagStrip mini no={strip} />
      <div className="mini-l" data-tauri-drag-region>
        <Topo cell={8} alpha={.85} depth={topoDepth} running={running} />
        <span className="k" data-tauri-drag-region>{meta}</span>
        <button type="button" className="mini-title" title="点一下修改名称、项目、标签" onClick={onTitle}><b><MarkedText content={title} /></b></button>
        <MiniBars filled={miniFilled} />
      </div>
      <div className="mini-r" data-tauri-drag-region>
        <div className="mini-read"><span className="k">{stateEn}</span><span className="mini-time">{digits}</span></div>
        {paused
          ? <button type="button" className="mini-btn go" aria-label="继续" title="继续" disabled={!canResume} onClick={onResume}><Icon name="play" /></button>
          : <button type="button" className="mini-btn go" aria-label="暂停" title="暂停" onClick={onPause}><Icon name="pause" /></button>}
        {onComplete && <button type="button" className="mini-btn" aria-label="完成" title="完成：会打开主窗口填写「做到哪了」" onClick={onComplete}><Icon name="check" /></button>}
        <button type="button" className="mini-btn" aria-label="关闭小窗口" title="关闭小窗口" onClick={onClose}><Icon name="x" /></button>
      </div>
    </div>
    {editor}
    <span className="mini-cap">{caption}</span>
  </div>;
}
