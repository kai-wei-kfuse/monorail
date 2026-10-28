import type { MainWindowBus, MiniMessage, MiniOutcome } from '../platform/windowBus';
import type { Ctx } from './commit';
import { dispatchMiniCommand } from './homeService';
import { projectMini } from './miniProjection';

export interface MiniEffects {
  openMain(): Promise<void>;
  complete(cardId: string, at: string): Promise<void>;
  report(error: unknown): void;
}
/** Main-window only. Every event error is reported; rejected commands receive the latest snapshot. */
export async function connectMini(ctx: Ctx, bus: MainWindowBus, effects: MiniEffects, heartbeatMs: number): Promise<() => void> {
  const push = async () => { const snapshot = ctx.snapshot(); if (snapshot) await bus.push(projectMini(snapshot)); };
  async function receive(message: MiniMessage): Promise<void> {
    if ('error' in message) {
      if (message.requestId !== null) await bus.reply({ requestId: message.requestId, outcome: { kind: 'error', message: message.error } });
      effects.report(new Error(message.error)); await push(); return;
    }
    let outcome: MiniOutcome;
    try {
      outcome = await dispatchMiniCommand(ctx, message.command);
      if (outcome.kind === 'openMain') await effects.openMain();
      if (outcome.kind === 'complete') { await effects.openMain(); await effects.complete(outcome.cardId, outcome.at); }
    }
    catch (error) {
      outcome = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    }
    await bus.reply({ requestId: message.command.requestId, outcome });
    await push();
  }
  const commandOff = await bus.onCommand(message => { void receive(message).catch(effects.report); });
  let readyOff: () => void;
  try { readyOff = await bus.onReady(() => { void push().catch(effects.report); }); }
  catch (error) { commandOff(); throw error; }
  const publishOff = ctx.onSnapshot(() => { void push().catch(effects.report); });
  const heartbeat = setInterval(() => { void push().catch(effects.report); }, heartbeatMs);
  try { await push(); }
  catch (error) { clearInterval(heartbeat); publishOff(); readyOff(); commandOff(); throw error; }
  return () => { clearInterval(heartbeat); publishOff(); readyOff(); commandOff(); };
}
