import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { MemoryFs } from '../../data/memoryFs';
import { createRepos } from '../../data/repos';
import { convert } from '../../domain/record/convert';
import type { Task } from '../../domain/task/task';
import { createContext, run } from '../../services/commit';
import { defaults } from '../../shared/settings';
import { appStore, publishProjection } from '../../store/appStore';
import { HomePage } from '../../pages/home/HomePage';
import { createActions } from '../actions';
import { CalendarScreen, ListScreen } from '../TimeScreens';
import * as edit from '../../services/timeEditService';
import type { Ctx } from '../../services/commit';
import type { Actions } from '../actions';
import { PREVIEW_PROJECTS, PREVIEW_TAGS } from './CalendarPreview';

/**
 * 首页接线预览（只在开发时用）：内存文件系统 + 真的仓库和 service，发布到真的 appStore，首页用真的 actions。
 * 一个主线任务带两张卡，两个收藏，今天上午两条记录。下面列出条目和待确认，方便截图核对。刷新页面数据就清空。
 * &view=calendar / list 换成日历页、列表页（真的 CalendarScreen / ListScreen）。&layout=fused 用融合布局。
 */
export function LivePreview() {
  const [actions, setActions] = useState<Actions | null>(null), [ctx, setCtx] = useState<Ctx | null>(null), [errors, setErrors] = useState<string[]>([]);
  const query = new URLSearchParams(location.search), view = query.get('view'), layout = query.get('layout');
  const entries = useStore(appStore, s => s.entries), home = useStore(appStore, s => s.home);
  useEffect(() => { void (async () => {
    const settings = structuredClone(defaults);
    settings.lists.projects = PREVIEW_PROJECTS; settings.lists.tags = PREVIEW_TAGS;
    if (layout === 'fused') settings.homeLayout = 'fused';
    settings.lists.presets = [{ id: 'f1', name: '学 408', project: '学习', tags: ['408'], mode: '切换', place: '计时条' },
      { id: 'f2', name: '回消息', project: '工作', tags: [], mode: '切换', place: '计时条' }];
    const repos = createRepos(new MemoryFs()), at = new Date().toISOString();
    const ctx = createContext({ repos, settings, id: () => crypto.randomUUID(), now: () => new Date().toISOString(),
      publish: publishProjection, log: async () => {}, reminders: { update: async () => {} }, random: Math.random });
    const task: Task = { id: 'job', name: '找到后端实习', slot: '主线', slot_index: 1, status: '进行中', created_at: at, bet_ends_at: null, default_project: '求职' };
    const cards = ['改 [简历] 第二版', '投 5 家公司'].map((text, i) => ({ ...convert({ id: crypto.randomUUID(), text, kind: '待办', created_at: at, due_at: null,
      blocking: false, task_id: 'job', card_id: null, tags: [], attachments: [] }, i + 1), id: 'card' + i }));
    await repos.transact(crypto.randomUUID(), await Promise.all([repos.tasks.write(task, null), ...cards.map(c => repos.cards.write(c, null))]));
    await run(ctx, async tx => { tx.state.home_mode = 'blank'; });
    const morning = (h: number) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.getTime(); };
    await edit.create(ctx, morning(9), morning(10), at, { description: '学 408', project: '学习', tags: ['408'] });
    await edit.create(ctx, morning(10), morning(11) - 30 * 60_000, at, { description: '回消息', project: '工作', tags: [] });
    setCtx(ctx);
    setActions(createActions(ctx, e => setErrors(l => [...l, e instanceof Error ? e.message : String(e)])));
  })(); }, []);
  if (!actions || !ctx) return <p style={{ padding: 32 }}>准备数据…</p>;
  const report = (e: unknown) => setErrors(l => [...l, e instanceof Error ? e.message : String(e)]);
  if (view === 'calendar' || view === 'list') return <div style={{ height: '100vh', display: 'grid', gridTemplateRows: 'minmax(0, 1fr) auto', padding: '14px 16px' }}>
    <div style={{ minHeight: 0, display: 'grid' }}>{view === 'calendar' ? <CalendarScreen ctx={ctx} report={report} /> : <ListScreen ctx={ctx} report={report} />}</div>
    <div id="state" style={{ font: '330 11px/1.5 var(--f-cn)' }}>{errors.length > 0 && `出错：${errors.join(' / ')}`}
      <ol>{entries.map(e => <li key={e.id}>{e.description} [{e.project}{e.tags.map(t => ' #' + t).join('')}] {new Date(e.started_at).toTimeString().slice(0, 5)}–{e.ended_at ? new Date(e.ended_at).toTimeString().slice(0, 5) : '现在'}</li>)}</ol></div>
  </div>;
  const hms = (iso: string) => new Date(iso).toTimeString().slice(0, 8);
  return <div style={{ height: '100vh', display: 'grid', gridTemplateRows: 'minmax(0, 1fr) auto', padding: '14px 16px', gap: 8 }}>
    <HomePage actions={actions} intro={null} completeAt={null} onCompleteConsumed={() => {}} shrinkFor={null} onShrinkConsumed={() => {}}
      look={{ titleScale: 1, topoMode: 'off', topoDepth: 0, shrinkMaxLevel: 3, timeboxDefault: 30 }} onGuide={() => {}} onOpenReview={() => {}} />
    <div id="state" style={{ font: '330 11px/1.5 var(--f-cn)', maxHeight: 120, overflow: 'auto' }}>
      <div>mode={home.mode} · 待确认：{home.pending ? hms(home.pending.startedAt) : '无'} · 卡：{home.card ? `${home.card.content}（${home.card.status}）` : '无'}{errors.length > 0 && ` · 出错：${errors.join(' / ')}`}</div>
      <ol>{entries.map(e => <li key={e.id}>{e.description} [{e.project}{e.tags.map(t => ' #' + t).join('')}]{e.card_id ? ' 卡' : ''} {e.kind} {hms(e.started_at)} – {e.ended_at ? hms(e.ended_at) : '现在'}</li>)}</ol>
    </div>
  </div>;
}
