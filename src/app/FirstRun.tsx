import { useEffect, useState } from 'react';
import { ActionButton } from '../ui/controls/Button';
import { TitleBar } from '../ui/frame/TitleBar';
import { WindowButtons } from '../ui/frame/WindowButtons';
import { Emblem } from '../ui/marks/Emblem';
import { Topo } from '../ui/effects/Topo';
import { chooseRoot } from '../platform/dialog';
import { windowControls } from '../platform/windowControls';
import './app.css';

/**
 * 首次使用：选择或新建数据目录。系统的「选择文件夹」对话框里可以直接新建文件夹。
 * 目录位置存在 app_config_dir/config.json；授权用 dialog + persisted-scope，重启后不用再选（架构 §5.4）。
 * 窗口没有系统边框，所以这里也要有标题栏：能拖动、能关。
 */
export function FirstRun({ onReady, error }: { onReady: (root: string) => void; error: string | null }) {
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false), [maximized, setMaximized] = useState(false);
  useEffect(() => {
    void windowControls.isPinned().then(setPinned);
    const onResize = () => void windowControls.isMaximized().then(setMaximized);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  async function pick() {
    setBusy(true); setMsg(null);
    try { const root = await chooseRoot(); if (root) onReady(root); }
    catch (e) { setMsg(`没选上：${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  }
  return <div className="first-frame">
    <TitleBar name="单轨" tabs={[]} active="" onTab={() => {}}>
      <WindowButtons pinned={pinned} maximized={maximized}
        onPin={() => void windowControls.setPinned(!pinned).then(() => setPinned(!pinned))} onMinimize={() => void windowControls.minimize()}
        onMaximize={() => void windowControls.toggleMaximize().then(() => windowControls.isMaximized()).then(setMaximized)}
        onClose={() => void windowControls.hide()} closeTitle="关闭（转到托盘）" />
    </TitleBar>
    <section className="first">
      <Topo mode="static" depth={45} />
      <div className="first-in">
        <Emblem className="first-emb" strokeWidth={1.5} />
        <span className="k">FIRST RUN</span>
        <h1>选一个文件夹放数据</h1>
        <p>记录、卡片、计时都存在这个文件夹里，是普通的 Markdown 文件，Obsidian、VS Code 都能直接打开。可以选一个空文件夹，也可以在对话框里新建一个。</p>
        <ActionButton primary cn="选择文件夹" en="CHOOSE FOLDER" icon="folder" disabled={busy} onClick={() => void pick()} />
        {(msg ?? error) && <p className="first-err" role="alert">{msg ?? error}</p>}
      </div>
    </section>
  </div>;
}
