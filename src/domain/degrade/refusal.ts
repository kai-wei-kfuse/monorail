import type { Settings } from '../../shared/settings';

export interface RefusalState { refusals: string[]; last_rest_ended_at: string | null }
export interface RefusalResult { state: RefusalState; action: 'none' | 'rest' | 'input' }
export function registerRefusal(state: RefusalState, at: string, settings: Settings): RefusalResult {
  const now = Date.parse(at), previous = state.refusals.at(-1);
  const expired = previous !== undefined && now - Date.parse(previous) >= settings.refusalResetMinutes * 60_000;
  const relevant = (expired ? [] : state.refusals).filter(time => now - Date.parse(time) <= settings.refusalWindowMinutes * 60_000);
  const refusals = [...relevant, at];
  if (refusals.length < settings.refusalThreshold) return { state: { ...state, refusals }, action: 'none' };
  const sinceRest = state.last_rest_ended_at === null ? Infinity : now - Date.parse(state.last_rest_ended_at);
  if (sinceRest >= 0 && sinceRest <= settings.inputHintWindowMinutes * 60_000) return { state: { ...state, refusals: [] }, action: 'input' };
  return { state: { ...state, refusals }, action: 'rest' };
}
export function finishRest(state: RefusalState, at: string): RefusalState { return { ...state, refusals: [], last_rest_ended_at: at }; }
