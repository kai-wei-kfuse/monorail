import { useEffect, useState } from 'react';
import type { UpdateState } from '../shared/updates';
import {
  deriveBuildChannel,
  updateBuildChannelLabels,
  updateChannelLabels,
  updatePhaseLabels,
  updateStepLabels,
} from '../shared/updates';
import { Button } from '../ui/controls/Button';

export interface UpdatePanelProps {
  state: UpdateState | null;
  connectionError: string | null;
  onCheck(): void;
  onJoinBeta?(): void;
  onLeaveBeta?(): void;
  onCheckStableTarget?(): void;
  onDismissTarget?(): void;
  onDownload(): void;
  onInstall(): void;
  onReconnect(): void;
}

export function UpdatePanel({
  state,
  connectionError,
  onCheck,
  onJoinBeta,
  onLeaveBeta,
  onCheckStableTarget,
  onDismissTarget,
  onDownload,
  onInstall,
  onReconnect,
}: UpdatePanelProps) {
  const [now, setNow] = useState(Date.now);
  const [confirmingJoinBeta, setConfirmingJoinBeta] = useState(false);
  const [exitedBetaNotice, setExitedBetaNotice] = useState(false);

  useEffect(() => {
    // Display elapsed seconds; this is a clock, not a deadline or an automatic retry.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const currentChannel = state ? (state.currentChannel ?? deriveBuildChannel(state.currentVersion)) : 'stable';
  const selectedChannel = state?.selectedChannel ?? 'stable';
  const intent = state?.intent ?? 'upgrade';
  const actionsDisabled = !state || state.busy || Boolean(connectionError);
  const startedAt = state?.history.at(-1)?.at ?? state?.updatedAt ?? now;
  const isReturnToStable = intent === 'returnToStable';
  const showStableReturnOptions =
    Boolean(state) && selectedChannel === 'stable' && (exitedBetaNotice || currentChannel === 'beta' || isReturnToStable);

  const handleConfirmJoinBeta = () => {
    setConfirmingJoinBeta(false);
    setExitedBetaNotice(false);
    onJoinBeta?.();
  };

  const handleLeaveBeta = () => {
    setConfirmingJoinBeta(false);
    setExitedBetaNotice(true);
    onLeaveBeta?.();
  };

  return (
    <section className="st-update" aria-label="软件更新">
      <div className="st-update-head">
        <div>
          <b>软件更新</b>
          {state && (
            <p className="st-update-meta">
              当前构建：<strong>v{state.currentVersion}</strong>（{updateBuildChannelLabels[currentChannel]}） · 当前更新渠道：
              <strong>{selectedChannel === 'beta' ? '已加入 Beta 体验' : updateChannelLabels[selectedChannel]}</strong>
            </p>
          )}
        </div>
        <div className="st-update-actions">
          <Button disabled={actionsDisabled} onClick={onCheck}>
            {state?.busy ? updatePhaseLabels[state.phase] + '…' : '检查更新'}
          </Button>
          {selectedChannel === 'beta' ? (
            <Button disabled={actionsDisabled} onClick={handleLeaveBeta}>
              退出 Beta
            </Button>
          ) : (
            <Button
              disabled={actionsDisabled}
              onClick={() => {
                setExitedBetaNotice(false);
                setConfirmingJoinBeta(true);
              }}
            >
              加入 Beta 体验
            </Button>
          )}
        </div>
      </div>

      {state?.busy && (
        <p className="st-update-busy-note">
          当前正在执行「{updatePhaseLabels[state.phase]} · {updateStepLabels[state.step]}」，操作完成前暂不能切换更新渠道。
        </p>
      )}

      {confirmingJoinBeta && selectedChannel === 'stable' && !state?.busy && (
        <div className="st-update-dialog" role="region" aria-label="加入 Beta 体验确认">
          <strong>确认加入 Beta 体验？</strong>
          <p>
            加入后将接收同产品的 Beta 测试版本（如 v0.3.0-beta.N）与正式版中较新的更新。此操作仅在本地保存渠道偏好，无需账号申请或提交个人信息。
          </p>
          <p>
            测试版本可能存在不稳定问题；应用内覆盖安装会保留当前全部业务数据与设置，并在启动安装器前自动建立且校验完整数据备份。您可随时退出 Beta。
          </p>
          <div className="st-update-actions">
            <Button tone="ink" disabled={actionsDisabled} onClick={handleConfirmJoinBeta}>
              确认加入 Beta
            </Button>
            <Button onClick={() => setConfirmingJoinBeta(false)}>取消</Button>
          </div>
        </div>
      )}

      {showStableReturnOptions && (
        <div className="st-update-dialog" role="region" aria-label="稳定版渠道选项">
          <strong>
            {currentChannel === 'beta'
              ? `当前运行 Beta 构建（v${state?.currentVersion}），更新渠道为稳定版`
              : '已退出 Beta 体验，当前为稳定版渠道'}
          </strong>
          <p>
            稳定版渠道偏好已持久化保存，退出 Beta 不会自动降级，也不会自动还原历史备份。您可以选择：
          </p>
          <p>
            1. <strong>留在当前版本，等待后续稳定更新</strong>：日常点击「检查更新」仅接收高于当前版本的正式稳定版。
          </p>
          <p>
            2. <strong>安装稳定版</strong>：查找当前最新正式稳定版（包含较低版本的兼容稳定版，如 v0.2.5），查看目标版本、兼容结论与备份说明后再确认是否覆盖安装，Beta 期间新增的数据将继续保留。
          </p>
          <div className="st-update-actions">
            <Button
              tone="ink"
              disabled={actionsDisabled}
              onClick={() => {
                onCheckStableTarget?.();
              }}
            >
              安装稳定版
            </Button>
            {exitedBetaNotice && !isReturnToStable && (
              <Button onClick={() => setExitedBetaNotice(false)}>留在当前版本，等待后续稳定更新</Button>
            )}
          </div>
        </div>
      )}

      <div className="st-update-status" role="status" aria-live="polite">
        <strong>{state ? (state.error ? '更新失败' : updatePhaseLabels[state.phase]) : '正在连接更新服务'}</strong>
        {state && (
          <p>
            {updateStepLabels[state.step]}
            {state.busy ? ` · 已等待 ${Math.max(0, Math.floor((now - startedAt) / 1000))} 秒` : ''}
          </p>
        )}
      </div>

      {state?.release && isReturnToStable && (
        <div className="st-update-dialog" role="region" aria-label="安装稳定版确认">
          <p>
            目标稳定版本：<strong>v{state.release.version}</strong>
            {state.release.tag ? `（${state.release.tag}）` : ''}
          </p>
          <p>
            版本变更类型：
            <strong>
              {state.release.isDowngrade
                ? `属于版本回退（从 v${state.currentVersion} 回退覆盖至稳定版 v${state.release.version}）`
                : `属于正式版升级（从 v${state.currentVersion} 升级至稳定版 v${state.release.version}）`}
            </strong>
          </p>
          {state.release.compatibility && (
            <p>
              数据兼容结论：
              <strong>{state.release.compatibility.compatible ? '已核验兼容（保留当前数据）' : '不兼容（已阻断覆盖）'}</strong>
              —— {state.release.compatibility.reason}
            </p>
          )}
          <p>
            备份与数据保留说明：应用内安装前将在冻结写入状态下自动创建并校验完整备份（含业务记录、待办、计时、附件、回执与配置授权）；覆盖安装直接沿用现有数据目录，Beta 期间新增的数据继续保留，不会自动还原到加入 Beta 前的旧备份。
          </p>
          <p className="st-update-notes">{state.release.notes ?? '此版本未提供更新说明。'}</p>
          {state.release.compatibility?.compatible !== false && state.phase === 'available' && (
            <div className="st-update-actions">
              <Button tone="ink" disabled={actionsDisabled} onClick={onDownload}>
                确认下载稳定版 v{state.release.version}
              </Button>
              <Button
                disabled={actionsDisabled}
                onClick={() => {
                  setExitedBetaNotice(false);
                  onDismissTarget?.();
                }}
              >
                留在当前版本
              </Button>
            </div>
          )}
          {state.release.compatibility?.compatible !== false && state.phase === 'ready' && (
            <>
              <p>签名验证已通过。点击下方按钮将先建立完整可核验备份，随后退出并覆盖安装稳定版 v{state.release.version}。</p>
              <div className="st-update-actions">
                <Button tone="ink" disabled={actionsDisabled} onClick={onInstall}>
                  确认重启并安装稳定版 v{state.release.version}
                </Button>
                <Button
                  disabled={actionsDisabled}
                  onClick={() => {
                    setExitedBetaNotice(false);
                    onDismissTarget?.();
                  }}
                >
                  留在当前版本
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {state?.release && !isReturnToStable && (
        <>
          <p>
            发现新版本 <strong>v{state.release.version}</strong>
            {state.release.channel ? `（${state.release.channel === 'beta' ? 'Beta 测试版' : '正式稳定版'}）` : ''}
          </p>
          {state.release.compatibility && <p>{state.release.compatibility.reason}</p>}
          <p className="st-update-notes">{state.release.notes ?? '此版本未提供更新说明。'}</p>
        </>
      )}

      {state && state.downloaded > 0 && (
        <div>
          <progress value={state.total ? state.downloaded : undefined} max={state.total ?? undefined} />
          <p>
            已下载 {(state.downloaded / 1024 / 1024).toFixed(2)} MB
            {state.total ? ` / ${(state.total / 1024 / 1024).toFixed(2)} MB` : ''}
          </p>
        </div>
      )}

      {!isReturnToStable && state?.phase === 'available' && (
        <Button tone="ink" disabled={actionsDisabled} onClick={onDownload}>
          下载更新
        </Button>
      )}
      {!isReturnToStable && state?.phase === 'ready' && (
        <>
          <p>安装前会自动建立并校验完整数据备份，安装时会退出并重新打开软件。</p>
          <Button tone="ink" disabled={actionsDisabled} onClick={onInstall}>
            重启并安装
          </Button>
        </>
      )}

      {state?.lastBackup && (
        <p className="st-update-backup-meta">
          最近一次安装前备份：v{state.lastBackup.fromVersion} → v{state.lastBackup.toVersion}（{state.lastBackup.fileCount}{' '}
          个文件，已校验 SHA-256，位置：{state.lastBackup.path}）
        </p>
      )}

      {state?.error && (
        <p className="st-err" role="alert">
          失败步骤：{updateStepLabels[state.error.step]}。{state.error.message}
        </p>
      )}
      {connectionError && (
        <div role="alert">
          <p className="st-err">更新状态连接失败：{connectionError}</p>
          <Button onClick={onReconnect}>重新连接状态</Button>
        </div>
      )}

      {state && state.history.length > 0 && (
        <details className="st-update-history">
          <summary>查看更新步骤</summary>
          <ol>
            {state.history.map((entry, index) => (
              <li key={index}>
                <time>{new Date(entry.at).toLocaleTimeString()}</time> {updateStepLabels[entry.step]}
              </li>
            ))}
          </ol>
        </details>
      )}

      <details className="st-update-help">
        <summary>旧版本无入口或从 GitHub 手动覆盖安装说明</summary>
        <p>
          若旧版尚未提供「加入 Beta 体验」入口，或需手动覆盖安装其他版本，请前往项目 GitHub Releases 下载同产品官方安装包（单轨_*_x64-setup.exe / monorail_*_windows-x86_64_setup.exe）。
        </p>
        <p>
          先退出正在运行的「单轨」，直接运行下载的安装包覆盖原安装目录（向导中选择「请勿卸载」直接覆盖，切勿先卸载并勾选「删除应用程序数据」）。覆盖安装不会触碰您的数据目录、设置与目录授权；手动安装前也可复制数据文件夹留存备份。安装完成后打开软件即可在此处选择加入或退出 Beta。
        </p>
      </details>
    </section>
  );
}
