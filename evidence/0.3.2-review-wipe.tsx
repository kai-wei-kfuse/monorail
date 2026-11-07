// Isolated reviewer page using production React components and an in-memory filesystem.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryFs } from '../src/data/memoryFs';
import { createRepos } from '../src/data/repos';
import { createContext, run } from '../src/services/commit';
import { defaults } from '../src/shared/settings';
import { publishProjection } from '../src/store/appStore';
import { createActions } from '../src/app/actions';
import { createCard } from '../src/domain/card/edit';
import { startCard } from '../src/services/homeService';
import { HomePage } from '../src/pages/home/HomePage';
import { setMotionLevel } from '../src/ui/effects/animate';
import '../src/ui/styles/base.css';
import '../src/ui/effects/effects.css';

const review = { wipeMounts: 0, frames: [] as { at: number; mounted: boolean }[], errors: [] as string[] };
(window as any).__review = review;
new MutationObserver(records => {
  for (const record of records) for (const n of record.addedNodes) {
    if (n instanceof Element) {
      const count = (n.matches('.wipe') ? 1 : 0) + n.querySelectorAll('.wipe').length;
      review.wipeMounts += count;
      if (count) review.frames.push({ at: performance.now(), mounted: true });
    }
  }
}).observe(document.body, { subtree: true, childList: true });
const settings = structuredClone(defaults);
settings.homeLayout = 'fused'; settings.topoMode = 'off';
const repos = createRepos(new MemoryFs()), at = new Date().toISOString();
const ctx = createContext({ repos, settings, id: () => crypto.randomUUID(), now: () => new Date().toISOString(), publish: publishProjection, log: async () => {}, reminders: { update: async () => {} }, random: Math.random });
const task = { id:'review-task', name:'Review task', slot:'主线' as const, slot_index:1, status:'进行中' as const, created_at:at, bet_ends_at:null, default_project:null };
const card = createCard('review-card', { content:'Start this card', type:'结果卡', timeboxMinutes:null, taskId:task.id, blocking:false, noShrink:false, dueAt:null, project:null, tags:[] }, at, 1);
await repos.transact(crypto.randomUUID(), [await repos.tasks.write(task,null),await repos.cards.write(card,null)]);
await run(ctx,async tx=>{ tx.state.current_card=null;tx.state.home_mode='blank'; },at,{action:'review.seed'});
setMotionLevel('full');
const actions = createActions(ctx,e=>review.errors.push(String(e)));
function Harness(){
 const [presentation,setPresentation]=useState<any>(null);
 return <div style={{height:'100vh',display:'grid',gridTemplateRows:'40px minmax(0,1fr)'}}>
  <button id="start" onClick={async()=>{const at=new Date().toISOString();await startCard(ctx,card.id,at);setPresentation({id:crypto.randomUUID(),cardId:card.id,at,previousView:null});}}>Start real card from blank stage</button>
  <HomePage actions={actions} look={{titleScale:65,topoMode:'off',topoDepth:0,timeboxDefault:60}} intro={null} completeAt={null} onCompleteConsumed={()=>{}} shrinkFor={null} onShrinkConsumed={()=>{}} onGuide={()=>{}} onOpenReview={()=>{}} bagStart={presentation} onBagStartConsumed={()=>setPresentation(null)} />
 </div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
