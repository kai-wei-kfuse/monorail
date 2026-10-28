import type { Settings, QuickActivity } from '../../shared/settings';
import type { EntryTemplate, TimeEntry } from '../../domain/timeline/entry';
import { newProject } from '../../domain/timeline/project';

interface PresetTransaction {
  readonly settings: Settings; readonly entries: TimeEntry[]; id(): string;
  saveSettings(settings: Settings): Promise<void>;
}
export type FavoriteValue = Omit<EntryTemplate, 'card_id'>;
async function savePresets(tx: PresetTransaction, presets: QuickActivity[]) {
  await tx.saveSettings({ ...tx.settings, lists: { ...tx.settings.lists, presets } });
}
function fields(value: FavoriteValue) {
  const name = value.description.trim(), project = value.project.trim();
  if (!name || !project) throw new Error('收藏的描述和项目不能为空');
  return { name, project, tags: [...new Set(value.tags.map(tag => tag.trim()).filter(Boolean))] };
}
export async function addFavoriteInTx(tx: PresetTransaction, value: FavoriteValue): Promise<string> {
  const data = fields(value), list = tx.settings.lists.presets;
  const existing = list.find(item => item.place === '计时条' && item.name === data.name);
  if (existing) return existing.id;
  const id = tx.id();
  await savePresets(tx, [...list, { ...data, id, place: '计时条', mode: '切换' }]);
  return id;
}
export async function favoriteInTx(tx: PresetTransaction, entryId: string): Promise<string> {
  const entry = tx.entries.find(item => item.id === entryId);
  if (!entry) throw new Error('计时条目不存在');
  return addFavoriteInTx(tx, entry);
}
export async function editFavoriteInTx(tx: PresetTransaction, id: string, value: FavoriteValue): Promise<void> {
  const list = tx.settings.lists.presets, data = fields(value);
  if (!list.some(item => item.id === id && item.place === '计时条')) throw new Error('收藏不存在');
  if (list.some(item => item.id !== id && item.place === '计时条' && item.name === data.name)) throw new Error('同名收藏已经存在');
  await savePresets(tx, list.map(item => item.id === id ? { ...item, ...data } : item));
}
export async function removeFavoriteInTx(tx: PresetTransaction, id: string): Promise<void> {
  if (!tx.settings.lists.presets.some(item => item.id === id && item.place === '计时条')) throw new Error('收藏不存在');
  await savePresets(tx, tx.settings.lists.presets.filter(item => item.id !== id));
}
export async function reorderFavoritesInTx(tx: PresetTransaction, ids: string[]): Promise<void> {
  const list = tx.settings.lists.presets, favorites = list.filter(item => item.place === '计时条');
  if (new Set(ids).size !== ids.length || ids.length !== favorites.length || ids.some(id => !favorites.some(item => item.id === id))) throw new Error('收藏排序必须包含全部收藏，且不能重复');
  await savePresets(tx, [...ids.map(id => favorites.find(item => item.id === id)!), ...list.filter(item => item.place !== '计时条')]);
}
export async function createProjectInTx(tx: PresetTransaction, name: string) {
  const project = newProject(tx.settings.lists.projects, name);
  await tx.saveSettings({ ...tx.settings, lists: { ...tx.settings.lists, projects: [...tx.settings.lists.projects, project] } });
  return project;
}
