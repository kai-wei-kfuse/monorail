import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { appStore } from '../store/appStore';
import { chooseRoot } from '../platform/dialog';
import { setMini } from '../platform/windowMode';
import { readLifecycle } from '../platform/lifecycle';
import { start, complete } from '../services/cardService';
import { insert, resume } from '../services/timerService';
import { reconcile } from '../services/recordService';
import type { Ctx } from '../services/commit';
import { bootstrap } from './bootstrap';

export function MainApp() {
  const projection = useStore(appStore);
  const [ctx, setCtx] = useState<Ctx | null>(null), [root, setRoot] = useState('');
  const [message, setMessage] = useState('请选择数据目录'), [mini, updateMini] = useState(false);
  const [now, setNow] = useState(Date.now());
  const open = projection.segments.find(s => s.ended_at === null);
  const active = projection.cards.find(c => c.id === projection.currentCard);
  const fail = (error: unknown) => setMessage(`错误：${String(error)}`);
  async function connect(directory: string) {
    const result = await bootstrap(directory);
    setCtx(result.ctx); setRoot(directory); setMessage('数据目录已连接');
    await invoke('evidence', { message: `connected:${directory}:cards=${appStore.getState().cards.length}` });
    if (import.meta.env.VITE_VERIFY === 'true') await (await import('../verification/main')).install(result.ctx);
    const lifecycle = await readLifecycle();
    if (lifecycle.previous_last_alive) setMessage(`离线追问：从 ${new Date(lifecycle.previous_last_alive).toISOString()} 到 ${new Date(lifecycle.startup_at).toISOString()} 在做什么？`);
  }
  useEffect(() => {
    void invoke<string | null>('shortcut_error').then(error => { if (error) appStore.setState({ error }); }).catch(fail);
    void invoke<string | null>('read_config').then(value => { if (value) return connect((JSON.parse(value) as { root: string }).root); }).catch(fail);
    const interval = setInterval(() => setNow(Date.now()), 1000);
    const unlisten = listen('power-event', event => { setMessage(`电源事件（模拟会明确标记）：${JSON.stringify(event.payload)}`); });
    const nativeErrors = listen('native-error', event => fail(event.payload));
    const visible = listen('main-visible', () => {
      const current = appStore.getState().segments.find(s => s.ended_at === null);
      void invoke('evidence', { message: `visible:${JSON.stringify({ now: Date.now(), segment: current, elapsedMs: current ? Date.now() - Date.parse(current.started_at) : null })}` }).catch(fail);
    });
    return () => { clearInterval(interval); void unlisten.then(fn => fn()); void nativeErrors.then(fn => fn()); void visible.then(fn => fn()); };
  }, []);
  async function action(work: () => Promise<unknown>) { try { await work(); } catch (error) { fail(error); } }
  async function toggleMini() { await setMini(!mini); updateMini(!mini); }
  if (mini) return <main>小窗 {active?.content ?? '待机'} · {open ? Math.floor((now - Date.parse(open.started_at)) / 1000) : 0}s <button onClick={() => void action(toggleMini)}>还原主窗口</button></main>;
  return <main style={{ padding: 16, fontFamily: 'sans-serif' }}>
    <h1>任务终端 · 技术验证骨架</h1>
    <p>数据目录：{root || '未选择'}</p>
    {!root && <button onClick={() => void action(async () => { const directory = await chooseRoot(); if (directory) await connect(directory); })}>选择数据目录</button>}
    <button onClick={() => void action(() => invoke('show_quickbar'))}>打开快速记录条</button>
    <button onClick={() => void action(async () => { await invoke('evidence', { message: `hidden:${JSON.stringify({ at: Date.now(), open })}` }); await getCurrentWindow().hide(); })}>隐藏到托盘（后台计时验证）</button>
    <button onClick={() => void action(toggleMini)}>切到520×88小窗</button>
    <button onClick={() => void action(async () => { await getCurrentWindow().maximize(); })}>最大化</button>
    <p role="status">{message}</p><p style={{ color: 'red' }}>{projection.error}</p>
    <h2>当前活动：{open?.activity ?? '尚未开始'} · {open ? Math.floor((now - Date.parse(open.started_at)) / 1000) : 0} 秒</h2>
    {ctx && <>
      <button onClick={() => void action(() => reconcile(ctx))}>重复 reconcile</button>
      <button onClick={() => void action(() => insert(ctx, '厕所', new Date().toISOString()))}>插入厕所</button>
      <button onClick={() => void action(() => resume(ctx, new Date().toISOString()))}>回来</button>
      <ul>{projection.cards.map(card => <li key={card.id}>{card.content} [{card.status}] {card.id}
        <button onClick={() => void action(() => start(ctx, card.id, new Date().toISOString()))}>开始</button>
        <button onClick={() => void action(() => complete(ctx, card.id, new Date().toISOString(), '骨架验证'))}>完成</button>
      </li>)}</ul>
    </>}
    <button onClick={() => void action(async () => { setMessage(JSON.stringify(await readLifecycle())); })}>读取 lifecycle</button>
    <button onClick={() => void action(async () => { await enable(); const on = await isEnabled(); await invoke('evidence', { message: `autostart-enabled:${on}` }); setMessage(`自启启用=${on}`); })}>启用自启</button>
    <button onClick={() => void action(async () => { await disable(); const on = await isEnabled(); await invoke('evidence', { message: `autostart-disabled:${!on}` }); setMessage(`自启关闭=${!on}`); })}>关闭自启</button>
    <p>所有显示时长均取 now − started_at；此界面不包含正式视觉或完整选卡规则。</p>
  </main>;
}
