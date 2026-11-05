import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../store/appStore';
import type { Ctx } from '../services/commit';
import * as recap from '../services/recapService';
import { recapViewStore } from '../platform/recapView';
import type { RecapViewPort } from '../platform/recapView';
import { DEFAULT_RECAP_VIEW } from '../shared/recap';
import type { RecapQuery, RecapResult, RecapViewState } from '../shared/recap';
import type { RecapBoardProps } from '../pages/review/recap/RecapBoard';

const WRITE_DEBOUNCE_MS = 500;
const CORRUPT_NOTICE = '上次的回看设置无法读取，已恢复默认';

/**
 * 回看看板的接线（执行方案 E7）：记住的选择（recap-view.json，读完之前先用默认值）、柱子筛选、查询与定时重查。
 * 选择改了以后防抖 500 ms 再写；页面卸载时把没写的那一次写掉。查询出错交给 report，看板显示上一次的结果。
 */
export function useRecap(ctx: Ctx, report: (error: unknown) => void, store: RecapViewPort = recapViewStore): RecapBoardProps {
  const version = useStore(appStore, s => s.home.dataVersion);
  const projects = useStore(appStore, s => s.settings.lists.projects), loose = useStore(appStore, s => s.settings.trackingMode === 'loose');
  const [view, setView] = useState<RecapViewState>(DEFAULT_RECAP_VIEW);
  const [loaded, setLoaded] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const [bucket, setBucket] = useState<string | null>(null), [tick, setTick] = useState(0);
  const pending = useRef<RecapViewState | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 用户在读完之前就改了选择时，以用户改的为准
  const touched = useRef(false);

  useEffect(() => {
    let alive = true;
    void store.read().then(({ view: v, corrupt }) => {
      if (!alive) return;
      if (!touched.current) setView(v);
      if (corrupt) setNotice(CORRUPT_NOTICE);
    }).catch(report).finally(() => { if (alive) setLoaded(true); });
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
      if (pending.current) void store.write(pending.current).catch(report);
    };
  }, [store]);

  const onView = (next: RecapViewState) => {
    touched.current = true; setView(next); pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { const v = pending.current; pending.current = null; if (v) void store.write(v).catch(report); }, WRITE_DEBOUNCE_MS);
  };

  const query: RecapQuery = useMemo(() => ({ period: view.period, from: view.from ?? undefined, to: view.to ?? undefined,
    dim: view.dim, includeIdle: view.includeIdle, bucket }), [view, bucket]);
  // tick：定时重查（正在计时时每分钟、否则到下一个活动日界）；version：数据变了
  const result = useMemo<RecapResult | null>(() => {
    try { return recap.query(ctx, query); }
    catch (error) { report(error); return null; }
  }, [ctx, query, version, tick]);
  useEffect(() => {
    const delay = (() => { try { return recap.refreshDelay(ctx, query); } catch { return 60_000; } })();
    const t = setTimeout(() => setTick(n => n + 1), delay);
    return () => clearTimeout(t);
  }, [ctx, query, version, tick]);

  const projectColors = useMemo(() => Object.fromEntries(projects.map(p => [p.name, p.color])), [projects]);
  return { result: loaded || touched.current ? result : null, view, onView, bucket, onBucket: setBucket,
    today: result?.today ?? '', minDay: result?.earliestDay ?? null, projectColors, notice, loose };
}
