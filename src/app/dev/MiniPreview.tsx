import { useMemo } from 'react';
import type { MiniCommand, MiniOutcome, MiniReply, MiniSnapshot, MiniWindowBus } from '../../platform/windowBus';
import { MiniApp } from '../MiniApp';

/**
 * 小窗预览（只在开发时用）：真的 MiniApp，接一个假的主窗口。假主窗口按命令改一份快照再推回去，规则只为看界面：
 * 暂停 / 继续、改名（editOpen）、待确认开始和放弃、改读数（直接改开始时刻）、完成（只回一句）。?stale 时从不发快照，看「主窗口未响应」。
 */
export function MiniPreview() {
  const params = new URLSearchParams(location.search);
  const stale = params.has('stale'), tiny = params.has('tiny');
  const bus = useMemo<MiniWindowBus>(() => {
    const iso = (t: number) => new Date(t).toISOString(), t0 = Date.now();
    let s: MiniSnapshot = {
      accent: '#00f5a0', miniMode: tiny ? 'tiny' : 'mini', epoch: 1, revision: 1, entryId: 'e1', cardId: null, pending_id: null,
      entry: { id: 'e1', description: '写周报', project: '工作', tags: [], startedAt: iso(t0 - 25 * 60_000), cardId: null, kind: '普通' },
      pending: null, resumeDescription: null, card: null, closedEffectiveMs: 0, currentSegStartedAt: null, awayActivity: null,
      projects: [{ name: '未分类', color: '#888884' }, { name: '工作', color: '#7c5cff' }, { name: '学习', color: '#1aa3ff' },
        { name: '求职', color: '#ff5a3c' }, { name: '英语口语练习打卡计划', color: '#ff2fa8' }], knownTags: ['周报', '408'],
      // 0.3.0-beta.4 D1：自动完成的演示数据（收藏、待做的卡、最近的记录）
      suggest: {
        favorites: [{ id: 'f1', name: '背单词', project: '学习', tags: ['英语'] }, { id: 'f2', name: '写周报', project: '工作', tags: [] }],
        cards: [{ id: 'c1', content: '整理 beta.4 小窗需求', track: '主线' }, { id: 'c2', content: '读《设计模式》第 3 章', track: '支线' }],
        recent: [{ id: 'r1', description: '投简历', project: '求职', tags: ['外企'] }, { id: 'r2', description: '看论文', project: '学习', tags: ['AI'] },
          { id: 'r3', description: '回邮件', project: '工作', tags: [] }],
      },
    };
    // ?idle：从待机开始（点名字就是写新事件）；?long：正在计的这一条分类名很长
    if (params.has('idle')) s = { ...s, entry: { ...s.entry!, id: 'idle', description: '待机', project: '待机' }, entryId: 'idle' };
    if (params.has('long')) s = { ...s, entry: { ...s.entry!, project: '英语口语练习打卡计划' } };
    let onSnap: ((v: MiniSnapshot) => void) | null = null, onReply: ((r: MiniReply) => void) | null = null;
    const push = (next: Partial<MiniSnapshot>) => { s = { ...s, ...next, revision: s.revision + 1 }; s.entryId = s.entry?.id ?? null; onSnap?.(s); };
    const entry = (description: string, project: string, tags: string[], from = Date.now()) =>
      ({ id: crypto.randomUUID(), description, project, tags, startedAt: iso(from), cardId: null, kind: '普通' as const });
    const handle = (c: MiniCommand): MiniOutcome => {
      switch (c.type) {
        case 'pause': push({ resumeDescription: s.entry!.description, entry: entry('待机', '待机', []) }); return { kind: 'done' };
        case 'resume': push({ entry: entry(s.resumeDescription!, '工作', []), resumeDescription: null }); return { kind: 'done' };
        case 'beginPending': push({ pending: { id: 'p' + s.revision, startedAt: iso(Date.now()) }, pending_id: 'p' + s.revision }); return { kind: 'done' };
        case 'cancelPending': push({ pending: null, pending_id: null }); return { kind: 'done' };
        case 'editOpen': {
          const p = c.patch, from = s.pending ? Date.parse(s.pending.startedAt) : undefined;
          if (s.entry && s.entry.project !== '待机' && !s.pending) push({ entry: { ...s.entry, description: p.description ?? s.entry.description, project: p.project ?? s.entry.project, tags: p.tags ?? s.entry.tags } });
          else push({ entry: entry(p.description ?? '（无描述）', p.project ?? '未分类', p.tags ?? [], from), pending: null, pending_id: null, resumeDescription: null });
          return { kind: 'done' };
        }
        case 'startFavorite': {
          const f = s.suggest.favorites.find(x => x.id === c.presetId)!;
          push({ entry: entry(f.name, f.project, f.tags), pending: null, pending_id: null }); return { kind: 'done' };
        }
        case 'startCard': {
          const k = s.suggest.cards.find(x => x.id === c.targetCardId)!;
          push({ entry: entry(k.content, '工作', []), pending: null, pending_id: null }); return { kind: 'done' };
        }
        case 'continueEntry': {
          const r = s.suggest.recent.find(x => x.id === c.targetEntryId)!;
          push({ entry: entry(r.description, r.project, r.tags), pending: null, pending_id: null }); return { kind: 'done' };
        }
        case 'setReadout':
          if (c.target.mode === 'idle') push({ pending: { id: 'p' + s.revision, startedAt: iso(Date.parse(c.at) - c.milliseconds) }, pending_id: 'p' + s.revision });
          else if (c.target.mode === 'pending') push({ pending: { ...s.pending!, startedAt: iso(Date.parse(c.at) - c.milliseconds) } });
          else push({ entry: { ...s.entry!, startedAt: iso(Date.parse(c.at) - c.milliseconds) } });
          return { kind: 'done' };
        default: return { kind: 'error', message: `预览里没做「${c.type}」` };
      }
    };
    return {
      onSnapshot: async h => { onSnap = h; return () => { onSnap = null; }; },
      onReply: async h => { onReply = h; return () => { onReply = null; }; },
      ready: async () => {
        if (stale) return;
        onSnap?.(s); setInterval(() => onSnap?.(s), 1000);
        // ?reload=毫秒：模拟主窗口 F5，到时换成下一个世代、修订号从头计数（D4）
        const reload = Number(params.get('reload'));
        if (reload > 0) setTimeout(() => { s = { ...s, epoch: s.epoch + 1, revision: 0 }; onSnap?.(s); }, reload);
      },
      send: async c => { setTimeout(() => onReply?.({ requestId: c.requestId, outcome: handle(c) }), 30); },
    };
  }, [stale, tiny]);
  return <div className="mini-body" style={{ width: tiny ? 320 : 520 }}><MiniApp bus={bus} onClose={async () => {}} /></div>;
}
