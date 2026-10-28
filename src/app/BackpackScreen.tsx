import { useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../store/appStore';
import { BackpackPage } from '../pages/backpack/BackpackPage';
import type { BackpackActions, BackpackTab } from '../pages/backpack/BackpackPage';
import type { Ctx } from '../services/commit';
import * as backpack from '../services/backpackService';
import * as ideas from '../services/ideaService';
import { pass } from '../services/cardService';

/** Wires the backpack page to the store projection and the M2 services. Errors surface through `report`. */
export function BackpackScreen({ ctx, report }: { ctx: Ctx; report: (error: unknown) => void }) {
  const view = useStore(appStore, state => state.backpack);
  const [tab, setTab] = useState<BackpackTab>('tasks');
  const { mainSlots, sideSlots, ideaPoolLimit, timeboxDefaultMinutes } = ctx.settings;
  const call = (work: () => Promise<unknown>) => { void work().catch(report); };
  const actions: BackpackActions = {
    createTask: (draft, at) => call(() => backpack.createTask(ctx, draft, at)),
    freezeTask: (id, at) => call(() => backpack.freezeTask(ctx, id, at)),
    abandonTask: (id, at) => call(() => backpack.abandonTask(ctx, id, at)),
    restoreTask: (id, slot, at, makeRoom) => call(() => backpack.restoreTask(ctx, id, slot, at, makeRoom)),
    saveCard: (cardId, fields, at) => call(() => backpack.saveCard(ctx, cardId, fields, at)),
    passCard: (cardId, at) => call(() => pass(ctx, cardId, at)),
    convertIdea: (ideaId, r) => call(() => ideas.convertIdea(ctx, ideaId, { content: r.content, taskId: r.taskId }, r.at)),
    deleteIdea: (ideaId, at) => call(() => ideas.deleteIdea(ctx, ideaId, at)),
  };
  return <BackpackPage tab={tab} onTab={setTab} tasks={view.tasks} queue={view.queue} ideas={view.ideas}
    mainSlots={mainSlots} sideSlots={sideSlots} ideaLimit={ideaPoolLimit} defaultTimebox={timeboxDefaultMinutes} actions={actions} />;
}
