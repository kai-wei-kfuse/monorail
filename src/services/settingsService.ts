import type { SettingKey, Settings } from '../shared/settings';
import type { DataDirectoryPort, SettingsPlatform } from '../platform/settings';
import type { Ctx } from './commit';
import { run } from './commit';
import type { HistorySource } from '../shared/history';
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
      try { await tx.saveSettings(settings); }
      catch (error) { throw new SettingFailure(key, error); }
      if (key === 'ideaExpireDays') expiredIdeas(tx.records, at, settings.ideaExpireDays).forEach(idea => tx.saveRecord(idea));
      refreshInTx(tx);
      // 系统接口（快捷键、开机自启、置顶）放在所有领域改动之后（ADR 0019 第 9 条）：它失败则整个事务不提交；
      // 它成功而 journal 随后失败时，队列封锁、重启后 applyPlatform 按持久设置重放
      try { await apply(ctx, key, settings); }
      catch (error) { throw new SettingFailure(key, error); }
    }, at, { action: 'settings.change', subject: { type: 'settings', id: key } });
    return { ok: true };
  } catch (error) {
    if (error instanceof SettingFailure) return { ok: false, errors: { [error.key]: error.message } };
    throw error;
  }
}

/** 首页的新建标签、临时活动「存为快捷活动」也走这里：source 记页面（缺省记设置页）。 */
export const changeLists = (ctx: Ctx, lists: Partial<Settings['lists']>, at: string, source?: HistorySource) => run(ctx, async tx => {
  await tx.saveSettings({ ...tx.settings, lists: { ...tx.settings.lists, ...lists } });
}, at, { action: 'settings.changeLists', ...(Object.keys(lists).length === 1 ? { subject: { type: 'settings' as const, id: `lists.${Object.keys(lists)[0]}` } } : {}),
  ...(source ? { source } : {}) });

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
