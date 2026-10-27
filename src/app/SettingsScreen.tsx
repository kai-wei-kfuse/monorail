import { useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../store/appStore';
import { SettingsPage } from '../pages/settings/SettingsPage';
import type { Ctx } from '../services/commit';
import { change, changeDataDirectory, changeLists } from '../services/settingsService';
import type { SettingsErrors } from '../services/settingsService';
import { chooseRoot } from '../platform/dialog';
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
  const [section, setSection] = useState('deal');
  const [errors, setErrors] = useState<SettingsErrors>(initialErrors);
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
  const onListsChange = (lists: Settings['lists']) => { void changeLists(ctx, lists, now()).then(onSaved).catch(report); };
  const onChangeDir = () => {
    void changeDataDirectory({ async changeDataDirectory() { if (await chooseRoot()) window.location.reload(); } }).catch(report);
  };
  return <SettingsPage section={section} onSection={setSection} settings={settings} onChange={onChange}
    onListsChange={onListsChange} dataDir={root} onChangeDir={onChangeDir} errors={errors} version={updates.state?.currentVersion ?? '读取中'}
    aboutExtras={<UpdatePanel state={updates.state} connectionError={updates.connectionError} onCheck={() => void updates.check()}
      onDownload={() => void updates.download()} onInstall={() => void updates.install()} onReconnect={() => void updates.reconnect()} />} />;
}
