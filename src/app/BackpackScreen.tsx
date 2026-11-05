import { useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../store/appStore';
import { BackpackPage } from '../pages/backpack/BackpackPage';
import type { BackpackActions, BackpackTab } from '../pages/backpack/BackpackPage';
import type { Ctx } from '../services/commit';
import * as backpack from '../services/backpackService';
import * as ideas from '../services/ideaService';
import * as preset from '../services/presetService';
import { pass } from '../services/cardService';
import { startCard } from '../services/homeService';
import { changeLists } from '../services/settingsService';

/** Wires the backpack page to the store projection and the N4 services. Errors surface through `report`. */
export function BackpackScreen({ ctx, report, onInfo }: { ctx: Ctx; report: (error: unknown) => void; onInfo?: (title: string, text: string) => void }) {
  const view = useStore(appStore, state => state.backpack);
  const [tab, setTab] = useState<BackpackTab>('pool');
  const { ideaPoolLimit, timeboxDefaultMinutes } = ctx.settings;
  const call = (work: () => Promise<unknown>) => { void work().catch(report); };
  const actions: BackpackActions = {
    createTask: (draft, at) => call(() => backpack.createTask(ctx, draft, at)),
    addItem: (taskId, content, at) => call(() => backpack.addItem(ctx, taskId, content, at)),
    setDefaultProject: (taskId, project, at) => call(() => backpack.setDefaultProject(ctx, taskId, project, at)),
    freezeTask: (id, at) => call(() => backpack.freezeTask(ctx, id, at)),
    abandonTask: (id, at) => call(() => backpack.abandonTask(ctx, id, at)),
    restoreTask: (id, slot, at, makeRoom) => call(() => backpack.restoreTask(ctx, id, slot, at, makeRoom)),
    saveCard: (cardId, fields, at) => call(() => backpack.saveCard(ctx, cardId, fields, at)),
    startCard: (cardId, at) => call(() => startCard(ctx, cardId, at)),
    passCard: (cardId, at) => call(() => pass(ctx, cardId, at)),
    convertIdea: (ideaId, input, at) => call(() => ideas.convertIdeaToTask(ctx, ideaId, input, at)),
    deleteIdea: (ideaId, at) => call(() => ideas.deleteIdea(ctx, ideaId, at)),
    completeIdea: (ideaId, text, at) => call(async () => {
      await ideas.complete(ctx, ideaId, at);
      onInfo?.(`已完成「${text.length > 16 ? text.slice(0, 15) + '…' : text}」`, '收进「已完成」；在那里可以撤销。');
    }),
    uncompleteIdea: (ideaId, at) => call(() => ideas.uncomplete(ctx, ideaId, at)),
    createProject: (name, at) => call(() => preset.createProject(ctx, name, at)),
    createTag: (tag, at) => call(() => ctx.settings.lists.tags.includes(tag) ? Promise.resolve() : changeLists(ctx, { tags: [...ctx.settings.lists.tags, tag] }, at)),
  };
  return <BackpackPage tab={tab} onTab={setTab} pool={view.pool} tasks={view.tasks} queue={view.queue} ideas={view.ideas} doneIdeas={view.doneIdeas}
    knownTags={view.pool.knownTags} ideaLimit={ideaPoolLimit} defaultTimebox={timeboxDefaultMinutes} actions={actions} />;
}
