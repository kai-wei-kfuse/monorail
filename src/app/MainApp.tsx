import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { appStore, dismissNotice } from '../store/appStore';
import type { Notice, NoticeResult } from '../shared/notices';
import type { Settings } from '../shared/settings';
import { setMini } from '../platform/windowMode';
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
import { cardView, HomePage, useNow } from '../pages/home/HomePage';
import type { GuideKind } from '../pages/home/GuideCard';
import { bootstrap } from './bootstrap';
import { createActions } from './actions';
import type { Actions } from './actions';
import { readyRoutes } from './routes';
import type { Route } from './routes';
import { FirstRun } from './FirstRun';
import { StatusBlock } from './shell/StatusBlock';
import { QuickActs } from './shell/QuickActs';
import type { QuickAct } from './shell/QuickActs';
import { BaselineMarks } from './shell/BaselineMarks';
import { MiniWindow } from './shell/MiniWindow';
import { NoticeHost } from './shell/NoticeHost';
import { useHotkeys } from './shell/hotkeys';
import '../ui/styles/base.css';
import './app.css';

const ICONS: [RegExp, IconName][] = [[/厕所|洗手间/, 'wc'], [/快递|取件/, 'parcel'], [/吃|饭|餐/, 'meal'], [/拉伸|运动|走/, 'stretch'], [/睡/, 'sleep']];
const iconFor = (name: string): IconName => ICONS.find(([re]) => re.test(name))?.[1] ?? 'break';
const now = () => new Date().toISOString();

type Phase = { kind: 'loading' } | { kind: 'first'; error: string | null } | { kind: 'ready'; ctx: Ctx; actions: Actions };

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
      setPhase({ kind: 'ready', ctx: result.ctx, actions: createActions(result.ctx, report) });
      await invoke('evidence', { message: `connected:${root}:cards=${appStore.getState().cards.length}` });
      if (import.meta.env.VITE_VERIFY === 'true') await (await import('../verification/main')).install(result.ctx, result.fs);
    } catch (error) { setPhase({ kind: 'first', error: `打不开这个数据目录：${error instanceof Error ? error.message : String(error)}` }); }
  }
  useEffect(() => {
    void invoke<string | null>('shortcut_error').then(e => { if (e) report(e); }).catch(report);
    void invoke<string | null>('read_config')
      .then(value => (value ? connect((JSON.parse(value) as { root: string }).root) : setPhase({ kind: 'first', error: null })))
      .catch(error => setPhase({ kind: 'first', error: String(error) }));
    const off = listen<string>('native-error', event => report(event.payload));
    return () => { void off.then(fn => fn()); };
  }, []);

  if (phase.kind === 'loading') return <div className="loading">正在打开数据目录…</div>;
  if (phase.kind === 'first') return <FirstRun error={phase.error} onReady={root => { setPhase({ kind: 'loading' }); void connect(root); }} />;
  return <Shell ctx={phase.ctx} actions={phase.actions} errors={errors} onErrorClose={id => setErrors(list => list.filter(e => e.id !== id))} />;
}

function Shell({ ctx, actions, errors, onErrorClose }: { ctx: Ctx; actions: Actions; errors: ToastItem[]; onErrorClose: (id: string) => void }) {
  const home = useStore(appStore, s => s.home), notices = useStore(appStore, s => s.notices);
  const settings: Settings = ctx.settings;
  const nowMs = useNow();
  const [page, setPage] = useState<Route['id']>('home');
  const [mini, setMiniState] = useState(false), [pinned, setPinned] = useState(false), [maximized, setMaximized] = useState(false);
  const [backfill, setBackfill] = useState(false);
  const [completeAt, setCompleteAt] = useState<string | null>(null), [shrinkFor, setShrinkFor] = useState<string | null>(null);
  const [intro, setIntro] = useState<{ kind: 'cold' | 'resume' }>({ kind: 'cold' });
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  // 说明性通知 6 秒后自己消失；出错通知要用户手动关
  const info = (title: string, text: string) => {
    const id = crypto.randomUUID();
    setToasts(t => [...t, { id, en: 'NOTE', title, text }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 6000);
  };

  const acts: QuickAct[] = useMemo(() => settings.lists.quickActivities.map(a => ({ id: a.id, name: a.name, icon: iconFor(a.name) })), [settings]);
  const activityOptions = settings.lists.quickActivities.map(a => ({ id: a.id, name: a.name }));
  const awayId = acts.find(a => a.name === home.awayActivity)?.id ?? null;

  useEffect(() => {
    void windowControls.isPinned().then(setPinned);
    void windowControls.isMaximized().then(setMaximized);
    // 双击标题栏、拖到屏幕边缘也会改变最大化状态，所以随窗口尺寸变化重新读一次
    const onResize = () => void windowControls.isMaximized().then(setMaximized);
    window.addEventListener('resize', onResize);
    const offs = [listen('main-visible', () => setIntro({ kind: 'resume' }))];
    return () => { window.removeEventListener('resize', onResize); offs.forEach(off => void off.then(fn => fn())); };
  }, []);
  useEffect(() => {
    // 页面切换：新页面从左往右擦入（UI 规范 §8.5）
    if (motionLevel() === 'full') play(stage.current?.firstElementChild, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 360, ease: 'snap' });
  }, [page]);

  async function toggleMini(on = !mini) {
    try { await setMini(on); setMiniState(on); } catch (error) { info('小窗切换失败', String(error)); }
  }
  function onGuide(kind: GuideKind) {
    if (kind === 'allDone') { void actions.showQuickbar(); return; }
    info('背包页还没接上', '项目和拆卡在背包页里做，M2 接线。现在可以先用快速记录条写一条待办，它会作为散件出卡。');
    void actions.showQuickbar();
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
      case 'subconscious': if ((r as NoticeResult['subconscious']).accept) info('放进支线格', '在背包页新建一个支线项目（M2 接线）。'); break;
      case 'restReturn': void actions.returnFromRest((r as NoticeResult['restReturn']).answer, at); break;
      case 'backfill': void actions.backfill(r as NoticeResult['backfill']); break;
      default: break;
    }
    dismissNotice(n.id);
  }

  useHotkeys({
    M: () => void toggleMini(),
    Q: () => void actions.showQuickbar(),
    ...Object.fromEntries(acts.slice(0, 9).map((a, i) => [String(i + 1), () => void (a.id === awayId ? actions.resume(now()) : actions.insert(a.id, now()))])),
  });

  const routes = readyRoutes();
  const view = cardView(home, nowMs);
  if (mini) {
    const v = view ?? { slotNo: '—', project: home.activity.label, type: '结果卡' as const, goalMinutes: null, content: home.activity.label || settings.lists.idleName,
      elapsedMs: home.activity.startedAt ? nowMs - Date.parse(home.activity.startedAt) : 0, progress: { filled: 0, miniFilled: 0, state: 'ready' as const, overMs: 0 } };
    const running = home.card?.status === '进行中';
    return <div className="mini-host"><MiniWindow view={v} running={running} topoDepth={settings.topoDepth} onRestore={() => void toggleMini(false)}
      onPrimary={at => {
        if (!home.card) { void toggleMini(false); return; }
        if (running) { void toggleMini(false).then(() => setCompleteAt(at)); } else void actions.start(home.card.id, at);
      }} /></div>;
  }

  const titleBar = <TitleBar name="像素记录" tabs={routes.map(r => ({ id: r.id, cn: r.cn, en: r.en }))} active={page} onTab={id => setPage(id as Route['id'])}>
    <StatusBlock kind={home.activity.kind} label={home.activity.label || settings.lists.idleName} startedAt={home.activity.startedAt} onClick={() => setBackfill(true)} />
    {page === 'home' && <button type="button" className="wc mini-btn-tb" aria-label="缩成悬浮小窗" title="缩成悬浮小窗（M）" onClick={() => void toggleMini(true)}><Icon name="shrink" /></button>}
    <WindowButtons pinned={pinned} maximized={maximized}
      onPin={() => void windowControls.setPinned(!pinned).then(() => setPinned(!pinned))} onMinimize={() => void windowControls.minimize()}
      onMaximize={() => void windowControls.toggleMaximize().then(() => windowControls.isMaximized()).then(setMaximized)} onClose={() => void windowControls.hide()} />
  </TitleBar>;
  const statusBar = <StatusBar
    left={<QuickActs acts={acts} current={awayId} onAdd={() => info('添加快捷活动', '快捷活动在设置页里添加（M3 接线）。')}
      onPick={(id, at) => void (id === awayId ? actions.resume(at) : actions.insert(id, at))} onSleep={at => void actions.sleep(at)} />}
    right={<BaselineMarks main={home.baseline.main} side={home.baseline.side} />} />;

  return <>
    <Frame titleBar={titleBar} statusBar={statusBar}>
      <div ref={stage} className="page">
        {page === 'home' && <HomePage actions={actions} intro={intro} completeAt={completeAt} onCompleteConsumed={() => setCompleteAt(null)}
          shrinkFor={shrinkFor} onShrinkConsumed={() => setShrinkFor(null)}
          look={{ titleScale: settings.titleScale, topoMode: settings.topoMode, topoDepth: settings.topoDepth, shrinkMaxLevel: settings.shrinkMaxLevel, timeboxDefault: settings.timeboxDefaultMinutes }}
          onGuide={onGuide} onOpenReview={() => info('每周回顾', '回顾页 M3 接线。')} onAddRest={() => info('添加休息项', '休息池在设置页里添加（M3 接线）。')} />}
      </div>
    </Frame>
    <NoticeHost notices={notices} onResolve={onResolve} onDismiss={n => dismissNotice(n.id)} extra={[...errors, ...toasts]}
      onExtraClose={id => { onErrorClose(id); setToasts(t => t.filter(x => x.id !== id)); }} />
    {backfill && <Backfill data={{ activities: activityOptions, now: now() }} dismiss={() => setBackfill(false)}
      resolve={r => { setBackfill(false); void actions.backfill(r); }} />}
  </>;
}
