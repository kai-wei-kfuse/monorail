import { useEffect, useState } from 'react';
import type { UpdateState } from '../shared/updates';
import { updatePhaseLabels, updateStepLabels } from '../shared/updates';
import { Button } from '../ui/controls/Button';

export function UpdatePanel({ state, connectionError, onCheck, onDownload, onInstall, onReconnect }:
  { state: UpdateState | null; connectionError: string | null; onCheck(): void; onDownload(): void; onInstall(): void; onReconnect(): void }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    // Display elapsed seconds; this is a clock, not a deadline or an automatic retry.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const startedAt = state?.history.at(-1)?.at ?? state?.updatedAt ?? now;
  return <section className="st-update" aria-label="软件更新">
    <div className="st-update-head"><b>软件更新</b><Button disabled={!state || state.busy || Boolean(connectionError)} onClick={onCheck}>
      {state?.busy ? updatePhaseLabels[state.phase] + '…' : '检查更新'}</Button></div>
    <div className="st-update-status" role="status" aria-live="polite">
      <strong>{state ? state.error ? '更新失败' : updatePhaseLabels[state.phase] : '正在连接更新服务'}</strong>
      {state && <p>{updateStepLabels[state.step]}{state.busy ? ` · 已等待 ${Math.max(0, Math.floor((now - startedAt) / 1000))} 秒` : ''}</p>}
    </div>
    {state?.release && <>
      <p>发现新版本 <strong>v{state.release.version}</strong></p>
      <p className="st-update-notes">{state.release.notes ?? '此版本未提供更新说明。'}</p>
    </>}
    {state && state.downloaded > 0 && <div><progress
      value={state.total ? state.downloaded : undefined} max={state.total ?? undefined} />
      <p>已下载 {(state.downloaded / 1024 / 1024).toFixed(2)} MB{state.total ? ` / ${(state.total / 1024 / 1024).toFixed(2)} MB` : ''}</p></div>}
    {state?.phase === 'available' && <Button tone="ink" onClick={onDownload}>下载更新</Button>}
    {state?.phase === 'ready' && <><p>安装时会退出并重新打开软件。</p>
      <Button tone="ink" onClick={onInstall}>重启并安装</Button></>}
    {state?.error && <p className="st-err" role="alert">失败步骤：{updateStepLabels[state.error.step]}。{state.error.message}</p>}
    {connectionError && <div role="alert"><p className="st-err">更新状态连接失败：{connectionError}</p>
      <Button onClick={onReconnect}>重新连接状态</Button></div>}
    {state && state.history.length > 0 && <details className="st-update-history"><summary>查看更新步骤</summary><ol>
      {state.history.map((entry, index) => <li key={index}><time>{new Date(entry.at).toLocaleTimeString()}</time> {updateStepLabels[entry.step]}</li>)}
    </ol></details>}
  </section>;
}
