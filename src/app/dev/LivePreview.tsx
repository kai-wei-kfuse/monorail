import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { MemoryFs } from '../../data/memoryFs';
import { createRepos } from '../../data/repos';
import { convert } from '../../domain/record/convert';
import type { Task } from '../../domain/task/task';
import { createContext, run } from '../../services/commit';
import { createInsertDraftCoordinator } from '../../services/insertDraftCoordinator';
import type { InsertDraft, InsertDraftCoordinator } from '../../services/insertDraftCoordinator';
import { timerStateTokenInTx } from '../../services/homeService';
import { defaults } from '../../shared/settings';
import { appStore, publishProjection } from '../../store/appStore';
import { HomePage } from '../../pages/home/HomePage';
import type { HomeInsertDraftProps } from '../../pages/home/HomePage';
import { createActions } from '../actions';
import { CalendarScreen, ListScreen } from '../TimeScreens';
import type { ListView } from '../../pages/list/ViewToggle';
import * as edit from '../../services/timeEditService';
import type { Ctx } from '../../services/commit';
import type { Actions } from '../actions';
import { PREVIEW_PROJECTS, PREVIEW_TAGS } from './CalendarPreview';
import { StatusBlock } from '../shell/StatusBlock';
import { BagScreen } from '../BagScreen';
import type { BagStartPresentation } from '../BagScreen';

/**
 * 首页接线预览（只在开发时用）：内存文件系统 + 真的仓库和 service，发布到真的 appStore，首页用真的 actions。
 * 一个主线任务带两张卡，两个收藏，今天上午两条记录。下面列出条目和待确认，方便截图核对。刷新页面数据就清空。
 * &view=calendar / list 换成日历页、列表页（真的 CalendarScreen / ListScreen）。&layout=fused 用融合布局。
 * &mode=loose 用宽松计时模式（ADR 0021 第 13 条）；&title 在上面加标题栏状态块（看灰灯）；&bag 一开始就拉开背包抽屉。
 */
export function LivePreview() {
  const [bagOpen, setBagOpen] = useState(() => new URLSearchParams(location.search).has('bagOpen')), [dealAt, setDealAt] = useState<string | null>(null);
  const [actions, setActions] = useState<Actions | null>(null), [ctx, setCtx] = useState<Ctx | null>(null), [errors, setErrors] = useState<string[]>([]);
  const [draftCoordinator, setDraftCoordinator] = useState<InsertDraftCoordinator | null>(null);
  const [insertDraft, setInsertDraft] = useState<InsertDraft | null>(null);
  const [draftForm, setDraftForm] = useState<{ text: string; project: string }>({ text: '', project: '未分类' });
  const [bagStart, setBagStart] = useState<BagStartPresentation | null>(null);
  const [previewSession] = useState(() => crypto.randomUUID());
  const query = new URLSearchParams(location.search), view = query.get('view'), layout = query.get('layout');
  const entries = useStore(appStore, s => s.entries), home = useStore(appStore, s => s.home);
  // &lv=history：列表页先显示操作历史（真的 historyService，数据是上面这些操作写下的）
  const [listView, setListView] = useState<ListView>(query.get('lv') === 'history' ? 'history' : 'entries');
  useEffect(() => {
    let coordinator: InsertDraftCoordinator | null = null;
    void (async () => {
      const settings = structuredClone(defaults);
      settings.lists.projects = PREVIEW_PROJECTS; settings.lists.tags = PREVIEW_TAGS;
      if (layout === 'split' || layout === 'fused') settings.homeLayout = layout;
      if (query.get('mode') === 'loose') settings.trackingMode = 'loose';
      settings.lists.presets = [{ id: 'f1', name: '学 408', project: '学习', tags: ['408'], mode: '切换', place: '计时条' },
        { id: 'f2', name: '回消息', project: '工作', tags: [], mode: '切换', place: '计时条' },
        { id: 'q1', name: '上厕所', project: '生活', tags: [], mode: '插入', place: '弹层' },
        { id: 'q2', name: '拿快递', project: '生活', tags: [], mode: '插入', place: '弹层' }];
      const repos = createRepos(new MemoryFs()), at = new Date().toISOString();
      const ctx = createContext({ repos, settings, id: () => crypto.randomUUID(), now: () => new Date().toISOString(),
        publish: publishProjection, log: async () => {}, reminders: { update: async () => {} }, random: Math.random });
      const task: Task = { id: 'job', name: '找到后端实习', slot: '主线', slot_index: 1, status: '进行中', created_at: at, bet_ends_at: null, default_project: '求职' };
      const cards = ['改 [简历] 第二版', '投 5 家公司'].map((text, i) => ({ ...convert({ id: crypto.randomUUID(), text, kind: '待办', created_at: at, due_at: null,
        blocking: false, task_id: 'job', card_id: null, tags: [], attachments: [] }, i + 1), id: 'card' + i }));
      await repos.transact(crypto.randomUUID(), await Promise.all([repos.tasks.write(task, null), ...cards.map(c => repos.cards.write(c, null))]));
      await run(ctx, async tx => { tx.state.home_mode = 'blank'; }, undefined, { action: 'dev.seed' });
      // 上午这两条：还没到上午（例如凌晨打开）时放到前一天，免得结束时间晚于现在
      const early = new Date().getHours() < 12;
      const morning = (h: number) => { const d = new Date(); if (early) d.setDate(d.getDate() - 1); d.setHours(h, 0, 0, 0); return d.getTime(); };
      await edit.create(ctx, morning(9), morning(10), at, { description: '学 408', project: '学习', tags: ['408'] });
      await edit.create(ctx, morning(10), morning(11) - 30 * 60_000, at, { description: '回消息', project: '工作', tags: [] });
      coordinator = createInsertDraftCoordinator(ctx);
      coordinator.onChange((next, invalidationMessage) => {
        setInsertDraft(prev => {
          if (next && next.owner === 'main' && prev?.id !== next.id) {
            setDraftForm({ text: '', project: '未分类' });
          }
          return next;
        });
        if (invalidationMessage) setErrors(l => [...l, invalidationMessage]);
      });
      setDraftCoordinator(coordinator);
      setCtx(ctx);
      setActions(createActions(ctx, e => setErrors(l => [...l, e instanceof Error ? e.message : String(e)])));
    })();
    return () => { coordinator?.dispose(); };
  }, []);
  if (!actions || !ctx || !draftCoordinator) return <p style={{ padding: 32 }}>准备数据…</p>;
  const report = (e: unknown) => setErrors(l => [...l, e instanceof Error ? e.message : String(e)]);
  const insertDraftProps: HomeInsertDraftProps = {
    draft: insertDraft,
    form: draftForm,
    onFormChange: patch => setDraftForm(f => ({ ...f, ...patch })),
    onBegin: async at => {
      try {
        const snap = ctx.snapshot();
        const open = snap?.entries.find(e => e.ended_at === null) ?? null;
        await draftCoordinator.begin({
          owner: 'main',
          ownerSession: previewSession,
          at,
          epoch: ctx.mainEpoch,
          expectedTimer: snap ? timerStateTokenInTx(snap) : undefined,
          entryId: open?.id ?? null,
          cardId: snap?.state.current_card ?? null,
        });
      } catch (e) { report(e); }
    },
    onCancel: async draftId => {
      try { await draftCoordinator.cancel({ draftId, epoch: ctx.mainEpoch }); } catch (e) { report(e); }
    },
    onSubmit: async (draftId, v) => {
      try {
        await draftCoordinator.commit({
          draftId,
          owner: 'main',
          ownerSession: previewSession,
          epoch: ctx.mainEpoch,
          text: v.description,
          project: v.project,
        });
        return true;
      } catch (e) { report(e); return false; }
    },
  };
  if (view === 'calendar' || view === 'list') return <div style={{ height: '100vh', display: 'grid', gridTemplateRows: 'minmax(0, 1fr) auto', padding: '14px 16px' }}>
    <div style={{ minHeight: 0, display: 'grid' }}>{view === 'calendar' ? <CalendarScreen ctx={ctx} report={report} />
      : <ListScreen ctx={ctx} report={report} view={listView} onView={setListView} onLocate={() => {}} />}</div>
    <div id="state" style={{ font: '330 11px/1.5 var(--f-cn)' }}>{errors.length > 0 && `出错：${errors.join(' / ')}`}
      <ol>{entries.map(e => <li key={e.id}>{e.description} [{e.project}{e.tags.map(t => ' #' + t).join('')}] {new Date(e.started_at).toTimeString().slice(0, 5)}–{e.ended_at ? new Date(e.ended_at).toTimeString().slice(0, 5) : '现在'}</li>)}</ol></div>
  </div>;
  const hms = (iso: string) => new Date(iso).toTimeString().slice(0, 8);
  return <div style={{ height: '100vh', display: 'grid', gridTemplateRows: query.has('title') ? 'auto minmax(0, 1fr) auto' : 'minmax(0, 1fr) auto', padding: '14px 16px', gap: 8 }}>
    {query.has('title') && <div style={{ display: 'flex', justifyContent: 'flex-end' }}><StatusBlock kind={home.looseIdle ? 'off' : home.activity.kind}
      label={home.looseIdle ? '没在计时' : home.activity.label || '待机'} startedAt={home.looseIdle ? null : home.activity.startedAt} onClick={() => {}} /></div>}
    <HomePage actions={actions} intro={null} completeAt={null} onCompleteConsumed={() => {}} shrinkFor={null} onShrinkConsumed={() => {}}
      insertDraft={insertDraftProps} bagStart={bagStart} onBagStartConsumed={() => setBagStart(null)}
      look={{ titleScale: ctx.settings.titleScale, topoMode: 'off', topoDepth: 0, timeboxDefault: ctx.settings.timeboxDefaultMinutes }} onGuide={() => {}} onOpenReview={() => {}}
      onDraw={query.has('bag') ? at => { setBagOpen(false); setDealAt(at); } : undefined} onOpenBag={() => setBagOpen(true)}
      drawer={query.has('bag') ? stage => <BagScreen ctx={ctx} open={bagOpen} onOpen={() => setBagOpen(true)} onClose={() => setBagOpen(false)} drawAt={dealAt} onDrawn={() => setDealAt(null)}
        onBagStarted={req => setBagStart(req)} report={report}>{stage}</BagScreen> : undefined} />
    <div id="state" style={{ font: '330 11px/1.5 var(--f-cn)', maxHeight: 120, overflow: 'auto' }}>
      <div>mode={home.mode} · 待确认：{home.pending ? hms(home.pending.startedAt) : '无'} · 卡：{home.card ? `${home.card.content}（${home.card.status}）` : '无'}{errors.length > 0 && ` · 出错：${errors.join(' / ')}`}
        {' · '}<button type="button" id="dev-resume" onClick={() => void actions.resume(new Date().toISOString())}>回到任务（外壳）</button>
        {' · '}<button type="button" id="dev-open-bag" onClick={() => setBagOpen(o => !o)}>背包</button>
        {' · '}<button type="button" id="dev-start-card" onClick={() => void actions.start('card0', new Date().toISOString())}>开始第一张卡</button>
        {' · '}<button type="button" id="dev-away-wc" onClick={() => void actions.startPreset('q1', new Date().toISOString())}>插入：上厕所</button>
        {' '}<button type="button" id="dev-away-parcel" onClick={() => void actions.startPreset('q2', new Date().toISOString())}>插入：拿快递</button>
      </div>
      <ol>{entries.map(e => <li key={e.id}>{e.description} [{e.project}{e.tags.map(t => ' #' + t).join('')}]{e.card_id ? ' 卡' : ''} {e.kind} {hms(e.started_at)} – {e.ended_at ? hms(e.ended_at) : '现在'}</li>)}</ol>
    </div>
  </div>;
}
