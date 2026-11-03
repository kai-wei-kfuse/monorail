import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Ctx } from '../services/commit';
import { handleApplicationRequest } from './applicationController';
import { applicationFailure } from '../shared/appError';

export async function connectApplicationBridge(ctx: Ctx, report: (error: unknown) => void) {
  let activeGeneration: number | null = null;
  const controllers = new Map<string, AbortController>();
  const offCancel = await listen<{ id: string; generation?: number }>('mcp-cancel', event => {
    if (activeGeneration !== null && event.payload.generation !== undefined && event.payload.generation !== activeGeneration) return;
    controllers.get(event.payload.id)?.abort();
  });
  const offRequest = await listen<{ id: string; generation?: number; request: unknown }>('mcp-request', event => {
    if (activeGeneration !== null && event.payload.generation !== undefined && event.payload.generation !== activeGeneration) return;
    const controller = new AbortController();
    controllers.set(event.payload.id, controller);
    const respond = async () => {
      let reply: unknown;
      try { reply = { result: await handleApplicationRequest(ctx, event.payload.request, controller.signal) }; }
      catch (error) { reply = { error: applicationFailure(error) }; }
      finally { controllers.delete(event.payload.id); }
      await invoke('respond_mcp', { id: event.payload.id, generation: event.payload.generation, reply });
    };
    void respond().catch(report);
  });
  const dispose = () => { offCancel(); offRequest(); };
  try {
    activeGeneration = await invoke<number>('start_mcp_bridge');
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
