import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../store/appStore';
import type { Ctx } from '../services/commit';
import * as historyService from '../services/historyService';
import type { HistoryPage } from '../services/historyService';
import type { HistoryRecord } from '../shared/history';

const message = (e: unknown) => e instanceof Error ? e.message : String(e);

/**
 * 按需查操作历史（ADR 0019 第 8 条）：数据变了（dataVersion）、看的天数变了就重新查；enabled 为 false 时不查。
 * 出错时保留上一次读到的内容，另给出错误文字。
 */
export function useHistoryPage(ctx: Ctx, days: number, enabled: boolean) {
  const version = useStore(appStore, s => s.home.dataVersion);
  const [state, setState] = useState<{ data: HistoryPage | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    historyService.list(ctx, days).then(data => { if (live) setState({ data, error: null }); }, e => { if (live) setState(s => ({ data: s.data, error: message(e) })); });
    return () => { live = false; };
  }, [ctx, days, version, enabled]);
  return state;
}

/** 设置 09「最近调用」。records 为 null 是还在读。 */
export function useRecentAutomation(ctx: Ctx, n: number, enabled: boolean) {
  const version = useStore(appStore, s => s.home.dataVersion);
  const [state, setState] = useState<{ records: HistoryRecord[] | null; error: string | null }>({ records: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    historyService.recentAutomation(ctx, n).then(records => { if (live) setState({ records, error: null }); }, e => { if (live) setState(s => ({ records: s.records, error: message(e) })); });
    return () => { live = false; };
  }, [ctx, n, version, enabled]);
  return state;
}
