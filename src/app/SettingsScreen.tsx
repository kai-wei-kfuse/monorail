import { useCallback, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../store/appStore';
import { SettingsPage } from '../pages/settings/SettingsPage';
import type { AutomationHostState } from '../pages/settings/automationData';
import type { Ctx } from '../services/commit';
import { closeMaintenance } from '../services/commit';
import { change, changeDataDirectory, changeLists } from '../services/settingsService';
import * as preset from '../services/presetService';
import type { SettingsErrors } from '../services/settingsService';
import { chooseRoot } from '../platform/dialog';
import { readAutomationHost } from '../platform/automation';
import type { SettingKey, Settings } from '../shared/settings';
import { UpdatePanel } from '../widgets/UpdatePanel';
import type { useUpdates } from './useUpdates';

const now = () => new Date().toISOString();

/**
 * Binds the settings page to settingsService. Changes apply immediately; a platform failure (e.g. a
 * hotkey taken by another app) shows on its own row and is not saved. Changing the data folder reloads the app.
 */
export function SettingsScreen({ ctx, root, initialErrors, onSaved, report, updates }:
  { ctx: Ctx; root: string; initialErrors: SettingsErrors; onSaved: () => void; report: (error: unknown) => void;
    updates: ReturnType<typeof useUpdates> }) {
  const settings = useStore(appStore, s => (s.ready ? s.settings : ctx.settings));
  const projects = useStore(appStore, s => s.backpack.pool.projects), knownTags = useStore(appStore, s => s.home.knownTags);
  const [section, setSection] = useState('deal');
  const [errors, setErrors] = useState<SettingsErrors>(initialErrors);
  const [automationHost, setAutomationHost] = useState<AutomationHostState>({ loading: true, info: null, error: null });

  const refreshAutomationHost = useCallback(() => {
    setAutomationHost(prev => ({ ...prev, loading: true, error: null }));
    void readAutomationHost().then(
      info => setAutomationHost({ loading: false, info, error: null }),
      err => {
        const message = err instanceof Error ? err.message : String(err);
        setAutomationHost({ loading: false, info: null, error: message });
      },
    );
  }, []);

  useEffect(() => {
    refreshAutomationHost();
  }, [refreshAutomationHost]);

  const onSelectSection = (nextSection: string) => {
    setSection(nextSection);
    if (nextSection === 'automation') {
      refreshAutomationHost();
    }
  };

  const onChange = <K extends SettingKey>(key: K, value: Settings[K]) => {
    void change(ctx, key, value, now()).then(result => {
      setErrors(previous => {
        const next = { ...previous };
        if (result.ok) delete next[key]; else Object.assign(next, result.errors);
        return next;
      });
      if (result.ok) onSaved();
    }).catch(report);
  };
  const onListsChange = (lists: Partial<Settings['lists']>) => { void changeLists(ctx, lists, now()).then(onSaved).catch(report); };
  // 预设编辑器里就地新建项目（自动配色）、标签
  const onCreateProject = (name: string) => { void preset.createProject(ctx, name, now()).then(onSaved).catch(report); };
  const onCreateTag = (tag: string) => { void preset.createTag(ctx, tag, now()).then(onSaved).catch(report); };
  const onChangeDir = () => {
    // 重载前先关掉旧数据目录上的维护任务（例如清理过期操作历史），正在执行的等它做完（0.3.0-beta.3 E8a1）
    void changeDataDirectory({ async changeDataDirectory() { if (await chooseRoot()) { await closeMaintenance(ctx); window.location.reload(); } } }).catch(report);
  };
  return <SettingsPage section={section} onSection={onSelectSection} settings={settings} onChange={onChange}
    onListsChange={onListsChange} projects={projects} knownTags={knownTags} onCreateProject={onCreateProject} onCreateTag={onCreateTag} dataDir={root} onChangeDir={onChangeDir} errors={errors} version={updates.state?.currentVersion ?? '读取中'}
    automationHost={automationHost} onRefreshAutomationHost={refreshAutomationHost}
    aboutExtras={<UpdatePanel state={updates.state} connectionError={updates.connectionError} onCheck={() => void updates.check()}
      onJoinBeta={() => void updates.joinBeta()} onLeaveBeta={() => void updates.leaveBeta()}
      onCheckStableTarget={() => void updates.checkStableTarget()} onDismissTarget={() => void updates.dismissTarget()}
      onDownload={() => void updates.download()} onInstall={() => void updates.install()} onReconnect={() => void updates.reconnect()} />} />;
}
