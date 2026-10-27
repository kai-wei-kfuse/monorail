import { useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../store/appStore';
import { BackpackPage } from '../pages/backpack/BackpackPage';
import type { BackpackActions, BackpackTab } from '../pages/backpack/BackpackPage';
import type { ProjectView } from '../store/backpackSlice';
import type { Ctx } from '../services/commit';
import * as backpack from '../services/backpackService';
import * as ideas from '../services/ideaService';
import { pass } from '../services/cardService';

/** Restores into a free side slot first, then main; the page has no slot chooser yet. */
function restoreSlot(projects: ProjectView[], mainSlots: number, sideSlots: number): '主线' | '支线' {
  const used = (slot: '主线' | '支线') => projects.filter(p => p.status === '进行中' && p.slot === slot).length;
  if (used('支线') < sideSlots) return '支线';
  if (used('主线') < mainSlots) return '主线';
  throw new Error('背包已满：先冷藏或放弃一个项目，再恢复');
}

/** Wires the backpack page to the store projection and the M2 services. Errors surface through `report`. */
export function BackpackScreen({ ctx, report }: { ctx: Ctx; report: (error: unknown) => void }) {
  const view = useStore(appStore, state => state.backpack);
  const [tab, setTab] = useState<BackpackTab>('projects');
  const { mainSlots, sideSlots, ideaPoolLimit, timeboxDefaultMinutes } = ctx.settings;
  const call = (work: () => Promise<unknown>) => { void work().catch(report); };
  const actions: BackpackActions = {
    createProject: (draft, at) => call(() => backpack.createProject(ctx, draft, at)),
    freezeProject: (id, at) => call(() => backpack.freezeProject(ctx, id, at)),
    abandonProject: (id, at) => call(() => backpack.abandonProject(ctx, id, at)),
    restoreProject: (id, at) => call(async () => backpack.restoreProject(ctx, id, restoreSlot(view.projects, mainSlots, sideSlots), at)),
    saveCard: (cardId, fields, at) => call(() => backpack.saveCard(ctx, cardId, fields, at)),
    passCard: (cardId, at) => call(() => pass(ctx, cardId, at)),
    convertIdea: (ideaId, r) => call(() => ideas.convertIdea(ctx, ideaId, { content: r.content, projectId: r.projectId }, r.at)),
    deleteIdea: (ideaId, at) => call(() => ideas.deleteIdea(ctx, ideaId, at)),
  };
  return <BackpackPage tab={tab} onTab={setTab} projects={view.projects} queue={view.queue} ideas={view.ideas}
    mainSlots={mainSlots} sideSlots={sideSlots} ideaLimit={ideaPoolLimit} defaultTimebox={timeboxDefaultMinutes} actions={actions} />;
}
