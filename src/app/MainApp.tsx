import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { appStore, dismissNotice } from '../store/appStore';
import type { Notice, NoticeResult } from '../shared/notices';
import type { Settings } from '../shared/settings';
import { updatePhaseLabels, updateStepLabels } from '../shared/updates';
import { miniWindow } from '../platform/miniWindow';
import { mainWindowBus, MINI_HEARTBEAT_MS } from '../platform/windowBus';
import { connectMini } from '../services/miniController';
import { windowControls } from '../platform/windowControls';
import type { Ctx } from '../services/commit';
import { Frame, StatusBar } from '../ui/frame/StatusBar';
import { TitleBar } from '../ui/frame/TitleBar';
import { WindowButtons } from '../ui/frame/WindowButtons';
import { Icon } from '../ui/icons/Icon';
import type { IconName } from '../ui/icons/Icon';
import type { ToastItem } from '../ui/overlay/Toast';
import { motionLevel, play, setMotionLevel } from '../ui/effects/animate';
import { Backfill } from '../widgets/notices/Backfill';
import { HomePage, useNow } from '../pages/home/HomePage';
import { favorites } from '../pages/home/timerView';
import type { GuideKind } from '../pages/home/GuideCard';
import { bootstrap } from './bootstrap';
import { createActions } from './actions';
import type { Actions } from './actions';
import { readyRoutes } from './routes';
import { BackpackScreen } from './BackpackScreen';
import { CalendarScreen, ListScreen } from './TimeScreens';
import { SettingsScreen } from './SettingsScreen';
import { ReviewScreen } from './ReviewScreen';
import { SavedBadge } from '../pages/settings/SettingsPage';
import type { SettingsErrors } from '../services/settingsService';
import type { Route } from './routes';
import { FirstRun } from './FirstRun';
import { StatusBlock } from './shell/StatusBlock';
import { QuickActs } from './shell/QuickActs';
import { MiniToggle } from './shell/MiniToggle';
import type { QuickAct } from './shell/QuickActs';
import { BaselineMarks } from './shell/BaselineMarks';
import { NoticeHost } from './shell/NoticeHost';
import { useHotkeys } from './shell/hotkeys';
import { useUpdates } from './useUpdates';
import '../ui/styles/base.css';
import './app.css';

const ICONS: [RegExp, IconName][] = [[/厕所|洗手间/, 'wc'], [/快递|取件/, 'parcel'], [/吃|饭|餐/, 'meal'], [/拉伸|运动|走/, 'stretch'], [/睡/, 'sleep']];
const iconFor = (name: string): IconName => ICONS.find(([re]) => re.test(name))?.[1] ?? 'break';
const now = () => new Date().toISOString();

type Phase = { kind: 'loading' } | { kind: 'first'; error: string | null } | { kind: 'ready'; ctx: Ctx; actions: Actions; root: string; platformErrors: SettingsErrors };

/** 主窗口外壳：标题栏 + 页面区 + 底栏；首次使用；小窗；提示。页面只登记在 routes.ts。 */
export function MainApp() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [errors, setErrors] = useState<ToastItem[]>([]);
  const report = (error: unknown) => setErrors(list => [...list.slice(-2),
    { id: crypto.randomUUID(), en: 'ERROR', title: '出错了', text: error instanceof Error ? error.message : String(error) }]);

  async function connect(root: string) {
    try {
      const result = await bootstrap(root);
      setMotionLevel(result.ctx.settings.motion);
      document.documentElement.style.setProperty('--yellow', result.ctx.settings.accent);
      setPhase({ kind: 'ready', ctx: result.ctx, actions: createActions(result.ctx, report), root, platformErrors: result.platformErrors });
      const failed = Object.values(result.platformErrors);
      if (failed.length) report(`有 ${failed.length} 项设置没有生效，详见设置页：${failed.join('；')}`);
      await invoke('evidence', { message: `connected:${root}:cards=${appStore.getState().cards.length}` });
      if (import.meta.env.VITE_VERIFY === 'true') await (await import('../verification/main')).install(result.ctx, result.fs);
    } catch (error) { setPhase({ kind: 'first', error: `打不开这个数据目录：${error instanceof Error ? error.message : String(error)}` }); }
  }
  useEffect(() => {
    void invoke<string | null>('read_config')
      .then(value => (value ? connect((JSON.parse(value) as { root: string }).root) : setPhase({ kind: 'first', error: null })))
      .catch(error => setPhase({ kind: 'first', error: String(error) }));
    const off = listen<string>('native-error', event => report(event.payload));
    return () => { void off.then(fn => fn()); };
  }, []);

  if (phase.kind === 'loading') return <div className="loading">正在打开数据目录…</div>;
  if (phase.kind === 'first') return <FirstRun error={phase.error} onReady={root => { setPhase({ kind: 'loading' }); void connect(root); }} />;
  return <Shell ctx={phase.ctx} actions={phase.actions} root={phase.root} platformErrors={phase.platformErrors} report={report}
    errors={errors} onErrorClose={id => setErrors(list => list.filter(e => e.id !== id))} />;
}

function Shell({ ctx, actions, root, platformErrors, report, errors, onErrorClose }: { ctx: Ctx; actions: Actions; root: string;
  platformErrors: SettingsErrors; report: (error: unknown) => void; errors: ToastItem[]; onErrorClose: (id: string) => void }) {
  const home = useStore(appStore, s => s.home), notices = useStore(appStore, s => s.notices);
  const updates = useUpdates(ctx);
  const settings: Settings = useStore(appStore, s => (s.ready ? s.settings : ctx.settings));
  const [saves, setSaves] = useState(0);
  // Appearance settings apply as soon as they are saved.
  useEffect(() => { setMotionLevel(settings.motion); document.documentElement.style.setProperty('--yellow', settings.accent); }, [settings.motion, settings.accent]);
  const nowMs = useNow();
  const [page, setPage] = useState<Route['id']>('home');
  const [miniOpen, setMiniOpen] = useState<boolean | null>(null), [pinned, setPinned] = useState(false), [maximized, setMaximized] = useState(false);
  const [backfill, setBackfill] = useState(false);
  const [completeAt, setCompleteAt] = useState<string | null>(null), [shrinkFor, setShrinkFor] = useState<string | null>(null);
  const [intro, setIntro] = useState<{ kind: 'cold' | 'resume' }>({ kind: 'cold' });
  const wasHidden = useRef(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  // 说明性通知 6 秒后自己消失；出错通知要用户手动关
  const info = (title: string, text: string) => {
    const id = crypto.randomUUID();
    setToasts(t => [...t, { id, en: 'NOTE', title, text }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 6000);
  };

  // 底栏弹层只放快捷活动（位置是弹层的预设）；收藏在首页计时条下面
  const acts: QuickAct[] = useMemo(() => settings.lists.presets.filter(a => a.place === '弹层').map(a => ({ id: a.id, name: a.name, icon: iconFor(a.name) })), [settings]);
  const activityOptions = settings.lists.presets.map(a => ({ id: a.id, name: a.name }));
  const awayId = acts.find(a => a.name === home.awayActivity)?.id ?? null;

  useEffect(() => {
    void windowControls.isPinned().then(setPinned);
    void windowControls.isMaximized().then(setMaximized);
    // 双击标题栏、拖到屏幕边缘也会改变最大化状态，所以随窗口尺寸变化重新读一次
    const onResize = () => void windowControls.isMaximized().then(setMaximized);
    const onVisibility = () => { if (document.hidden) wasHidden.current = true; };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    const offs = [listen('main-visible', () => {
      if (!wasHidden.current) return;
      wasHidden.current = false;
      setIntro({ kind: 'resume' });
    })];
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      offs.forEach(off => void off.then(fn => fn()));
    };
  }, []);
  useEffect(() => {
    // 页面切换：新页面从左往右擦入（UI 规范 §8.5）
    if (motionLevel() === 'full') play(stage.current?.firstElementChild, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 360, ease: 'snap' });
  }, [page]);

  // 小窗是独立窗口（N6）：主窗口照常开着；底栏按钮、M、托盘都是开关
  async function toggleMini() {
    try { await miniWindow.toggle(); } catch (error) { info('小窗切换失败', String(error)); }
  }
  // 给小窗发快照、接它的命令。在小窗里点完成：主窗口出来，回到首页接着走完成流程，保留小窗里点的时刻
  useEffect(() => {
    const off = connectMini(ctx, mainWindowBus, {
      openMain: () => miniWindow.showMain(),
      complete: async (_cardId, at) => { setPage('home'); setCompleteAt(at); },
      report,
    }, MINI_HEARTBEAT_MS);
    return () => { void off.then(fn => fn()); };
  }, [ctx]);
  // 底栏按钮跟着小窗真实的显示状态（小窗自己关、托盘开关也算）；toggle 的返回值不当状态用
  useEffect(() => {
    const off = miniWindow.subscribeVisibility(setMiniOpen).catch(error => { report(error); return () => {}; });
    return () => { void off.then(fn => fn()); };
  }, []);
  function onGuide(kind: GuideKind) {
    // 建项目、设主线、给主线拆卡都在背包页做；卡都做完了就去写一条
    if (kind === 'allDone') { void actions.showQuickbar(); return; }
    setPage('backpack');
  }
  function onResolve(n: Notice, r: NoticeResult[keyof NoticeResult]) {
    const at = (r as { at: string }).at;
    switch (n.kind) {
      case 'offlineAsk': { const d = n.data as Notice<'offlineAsk'>['data']; void actions.answerOffline(d.from, d.to, (r as NoticeResult['offlineAsk']).activity, at); break; }
      case 'longActivity': if (!(r as NoticeResult['longActivity']).still) setBackfill(true); break;
      case 'skipSignal': {
        const choice = (r as NoticeResult['skipSignal']).choice, cardId = (n.data as Notice<'skipSignal'>['data']).cardId;
        if (choice === 'pass') void actions.pass(cardId, at);
        else if (choice === 'split') { setPage('home'); setShrinkFor(cardId); }
        break;
      }
      case 'subconscious': if ((r as NoticeResult['subconscious']).accept) setPage('backpack'); break;
      case 'restReturn': void actions.returnFromRest((r as NoticeResult['restReturn']).answer, at); break;
      case 'backfill': void actions.backfill(r as NoticeResult['backfill']); break;
      default: break;
    }
    dismissNotice(n.id);
  }

  useHotkeys({
    M: () => void toggleMini(),
    Q: () => void actions.showQuickbar(),
    // 数字键 1–9 在首页启动收藏（v0.3）。快捷活动弹层开着时由弹层自己接，不会到这里
    ...(page === 'home' ? Object.fromEntries(favorites(settings).slice(0, 9).map((f, i) =>
      [String(i + 1), () => void actions.startPreset(f.id, now())])) : {}),
  });

  const routes = readyRoutes();

  const titleBar = <TitleBar name="单轨" tabs={routes.map(r => ({ id: r.id, cn: r.cn, en: r.en }))} active={page} onTab={id => setPage(id as Route['id'])}>
    <StatusBlock kind={home.activity.kind} label={home.activity.label || settings.lists.idleName} startedAt={home.activity.startedAt} onClick={() => setBackfill(true)} />
    <WindowButtons pinned={pinned} maximized={maximized}
      onPin={() => void windowControls.setPinned(!pinned).then(() => setPinned(!pinned))} onMinimize={() => void windowControls.minimize()}
      onMaximize={() => void windowControls.toggleMaximize().then(() => windowControls.isMaximized()).then(setMaximized)}
      onClose={() => { wasHidden.current = true; void windowControls.hide(); }} />
  </TitleBar>;
  const statusBar = <StatusBar
    left={<><QuickActs acts={acts} current={awayId}
      onPick={(id, at) => void (id === awayId ? actions.resume(at) : actions.startPreset(id, at))} onSleep={at => void actions.sleep(at)}
      onTemp={(name, keep, at) => void actions.tempActivity(name, keep, at)} />
      <button type="button" className="dock-toggle mini-toggle" title={`打开快速记录条（Q / ${settings.quickbarHotkey}）`} onClick={() => void actions.showQuickbar()}>
        <span className="chev"><Icon name="plus" /></span><span className="t-cn">快速记录</span>
      </button>
      <MiniToggle on={miniOpen} onClick={() => void toggleMini()} /></>}
    right={<>{page === 'settings' && <SavedBadge saves={saves} />}<BaselineMarks main={home.baseline.main} side={home.baseline.side} /></>} />;

  return <>
    <Frame titleBar={titleBar} statusBar={statusBar}>
      <div ref={stage} className="page">
        {page === 'home' && <HomePage actions={actions} intro={intro} completeAt={completeAt} onCompleteConsumed={() => setCompleteAt(null)}
          shrinkFor={shrinkFor} onShrinkConsumed={() => setShrinkFor(null)}
          look={{ titleScale: settings.titleScale, topoMode: settings.topoMode, topoDepth: settings.topoDepth, shrinkMaxLevel: settings.shrinkMaxLevel, timeboxDefault: settings.timeboxDefaultMinutes }}
          onGuide={onGuide} onOpenReview={() => setPage('review')} />}
        {page === 'calendar' && <CalendarScreen ctx={ctx} report={report} />}
        {page === 'list' && <ListScreen ctx={ctx} report={report} />}
        {page === 'review' && <ReviewScreen ctx={ctx} report={report} />}
        {page === 'settings' && <SettingsScreen ctx={ctx} root={root} initialErrors={platformErrors} onSaved={() => setSaves(n => n + 1)} report={report} updates={updates} />}
        {page === 'backpack' && <BackpackScreen ctx={ctx} report={error => info('操作没有完成', String(error instanceof Error ? error.message : error))} />}
      </div>
    </Frame>
    <NoticeHost notices={notices} onResolve={onResolve} onDismiss={n => dismissNotice(n.id)} extra={[...errors, ...toasts]}
      onExtraClose={id => { onErrorClose(id); setToasts(t => t.filter(x => x.id !== id)); }} />
    {backfill && <Backfill data={{ activities: activityOptions, now: now() }} dismiss={() => setBackfill(false)}
      resolve={r => { setBackfill(false); void actions.backfill(r); }} />}
    {updates.state && ['preparing', 'installing'].includes(updates.state.phase) && <div className="update-shield" role="alert"><div>
      <b>{updatePhaseLabels[updates.state.phase]}</b><p>{updateStepLabels[updates.state.step]}</p>
      <p>已等待 {Math.max(0, Math.floor((nowMs - (updates.state.history.at(-1)?.at ?? nowMs)) / 1000))} 秒</p>
      {updates.connectionError && <p>{updates.connectionError}</p>}
    </div></div>}
  </>;
}
