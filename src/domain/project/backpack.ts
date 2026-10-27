import { inBackpack } from './project';
import type { Project } from './project';
import type { Settings } from '../../shared/settings';
import type { BackpackSlot } from '../../shared/backpack';

export function putInBackpack(project: Project, slot: BackpackSlot, projects: Project[], settings: Settings, at: string): Project {
  if (inBackpack(project) && project.slot === slot) return { ...project };
  const active = projects.filter(item => item.id !== project.id && inBackpack(item));
  const main = active.filter(item => item.slot === '主线').length, side = active.length - main;
  if (main > settings.mainSlots || side > settings.sideSlots || (slot === '主线' ? main >= settings.mainSlots : side >= settings.sideSlots)) {
    throw new Error('背包格已满，请先冷藏或放弃项目');
  }
  const used = new Set(active.map(item => item.slot_index));
  let index = 1;
  while (used.has(index)) index++;
  const end = new Date(at); end.setDate(end.getDate() + settings.betWeeks * 7);
  return { ...project, slot, slot_index: inBackpack(project) ? project.slot_index : index, status: '进行中', bet_ends_at: slot === '主线' ? end.toISOString() : null };
}

export function leaveBackpack(project: Project, status: '冷藏' | '已放弃'): Project {
  return { ...project, slot: '不在背包', slot_index: null, status, bet_ends_at: null };
}
