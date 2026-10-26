import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { tauriFs } from '../data/fs';
import { defaults } from '../shared/settings';
import { nativeReminders } from '../platform/reminders';
import { createContext } from '../services/commit';
import { reconcile } from '../services/recordService';
import { appStore } from '../store/appStore';

export async function bootstrap(root: string) {
  const fs = await tauriFs(root);
  const ctx = createContext({
    fs, settings: defaults, reminders: nativeReminders, id: () => crypto.randomUUID(), now: () => new Date().toISOString(),
    publish: value => appStore.setState({ cards: value.cards, segments: value.segments, currentCard: value.state.current_card, ready: true }),
    log: message => invoke('evidence', { message }),
  });
  const report = (error: unknown) => appStore.setState({ error: String(error) });
  // Register before recovery/reconciliation, so the initial scan also covers missed events.
  let booting = true;
  let dirty = false;
  const refresh = () => {
    // Coalesce notifications while journal replay owns the files; reconcile scans all records.
    if (booting) { dirty = true; return; }
    void reconcile(ctx).catch(report);
  };
  const offChanged = await listen('data-changed', refresh);
  const offVisible = await listen('main-visible', refresh);
  try {
    const recovered = await ctx.journal.recover();
    await ctx.log(`journal-recovered:${recovered}`);
    await reconcile(ctx);
    booting = false;
    if (dirty) await reconcile(ctx);
  } catch (error) { offChanged(); offVisible(); throw error; }
  return { ctx, dispose: () => { offChanged(); offVisible(); } };
}
