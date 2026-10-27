import type { SettingKey, Settings } from '../shared/settings';
import type { DataDirectoryPort, SettingsPlatform } from '../platform/settings';
import type { Ctx } from './commit';
import { run } from './commit';
import { refreshInTx } from './dealService';
import { expiredIdeas } from '../domain/idea/pool';

export type SettingsErrors = Partial<Record<SettingKey, string>>;
export type ChangeResult = { ok: true } | { ok: false; errors: SettingsErrors };
class SettingFailure extends Error {
  constructor(readonly key: SettingKey, cause: unknown) { super(cause instanceof Error ? cause.message : String(cause), { cause }); }
}
function platform(ctx: Ctx): SettingsPlatform {
  if (!ctx.settingsPlatform) throw new Error('未注入系统设置能力');
  return ctx.settingsPlatform;
}
async function apply(ctx: Ctx, key: SettingKey, settings: Settings): Promise<void> {
  if (key === 'quickbarHotkey' || key === 'mainHotkey') await platform(ctx).setHotkey(key, settings[key]);
  else if (key === 'autostart') await platform(ctx).setAutostart(settings.autostart);
  else if (key === 'alwaysOnTop') await platform(ctx).setAlwaysOnTop(settings.alwaysOnTop);
}

export async function change<K extends SettingKey>(ctx: Ctx, key: K, value: Settings[K], at: string): Promise<ChangeResult> {
  try {
    await run(ctx, async tx => {
      const settings = { ...tx.settings, [key]: value };
      try { await tx.saveSettings(settings); await apply(ctx, key, settings); }
      catch (error) { throw new SettingFailure(key, error); }
      if (key === 'ideaExpireDays') expiredIdeas(tx.records, at, settings.ideaExpireDays).forEach(idea => tx.saveRecord(idea));
      refreshInTx(tx);
    }, at);
    return { ok: true };
  } catch (error) {
    if (error instanceof SettingFailure) return { ok: false, errors: { [error.key]: error.message } };
    throw error;
  }
}

export const changeLists = (ctx: Ctx, lists: Partial<Settings['lists']>, at: string) => run(ctx, async tx => {
  await tx.saveSettings({ ...tx.settings, lists: { ...tx.settings.lists, ...lists } });
}, at);

/** Reconcile OS state from the durable configuration on every startup/recovery. */
export async function applyPlatform(ctx: Ctx): Promise<SettingsErrors> {
  const errors: SettingsErrors = {};
  for (const key of ['quickbarHotkey', 'mainHotkey', 'autostart', 'alwaysOnTop'] as const) {
    try { await apply(ctx, key, ctx.settings); }
    catch (error) { errors[key] = error instanceof Error ? error.message : String(error); }
  }
  return errors;
}
export const changeDataDirectory = (port: DataDirectoryPort): Promise<void> => port.changeDataDirectory();
