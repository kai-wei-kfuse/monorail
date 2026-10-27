import { activityDay } from '../domain/timeline/day';
import type { LifecycleSource, PowerEvent } from '../platform/lifecycle';
import type { Ctx } from './commit';
import { settleOffline } from './timerService';

export interface SchedulerDeps {
  lifecycle: LifecycleSource;
  /** Runs once per activity day change, e.g. to re-deal the home card. */
  onDayChanged(day: string): Promise<void>;
  report(error: unknown): void;
}
const iso = (ms: number) => new Date(ms).toISOString();

/** Milliseconds from `now` until the next local day boundary. */
export function untilBoundary(now: string, boundaryHour: number): number {
  const next = new Date(now);
  next.setHours(boundaryHour, 0, 0, 0);
  if (next.getTime() <= Date.parse(now)) next.setDate(next.getDate() + 1);
  return next.getTime() - Date.parse(now);
}

/**
 * Time-driven work that no user action triggers. WebView timers are unreliable in the
 * background, so every trigger re-derives state from the wall clock instead of counting ticks.
 */
export async function startScheduler(ctx: Ctx, deps: SchedulerDeps): Promise<() => void> {
  let day = activityDay(ctx.now(), ctx.settings.dayBoundaryHour);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const checkDay = async () => {
    const current = activityDay(ctx.now(), ctx.settings.dayBoundaryHour);
    if (current === day) return;
    day = current;
    await deps.onDayChanged(current);
  };
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { void checkDay().catch(deps.report).finally(arm); }, untilBoundary(ctx.now(), ctx.settings.dayBoundaryHour) + 1000);
  };
  const onPower = (event: PowerEvent) => {
    if (event.kind !== 'resume' || event.suspended_at === null || event.resumed_at === null) return;
    void settleOffline(ctx, { start: iso(event.suspended_at), end: iso(event.resumed_at) })
      .then(checkDay).catch(deps.report).finally(arm);
  };

  const life = await deps.lifecycle.read();
  if (life.previous_last_alive !== null) await settleOffline(ctx, { start: iso(life.previous_last_alive), end: iso(life.startup_at) });
  const off = await deps.lifecycle.onPower(onPower);
  arm();
  return () => { clearTimeout(timer); off(); };
}
