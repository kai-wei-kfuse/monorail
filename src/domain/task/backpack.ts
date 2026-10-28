import { inBackpack } from './task';
import type { Task } from './task';
import type { Settings } from '../../shared/settings';
import type { BackpackSlot } from '../../shared/backpack';

export function putInBackpack(task: Task, slot: BackpackSlot, tasks: Task[], settings: Settings, at: string): Task {
  if (inBackpack(task) && task.slot === slot) return { ...task };
  const active = tasks.filter(item => item.id !== task.id && inBackpack(item));
  const main = active.filter(item => item.slot === '主线').length, side = active.length - main;
  if (main > settings.mainSlots || side > settings.sideSlots || (slot === '主线' ? main >= settings.mainSlots : side >= settings.sideSlots)) {
    throw new Error('背包格已满，请先冷藏或放弃项目');
  }
  const used = new Set(active.map(item => item.slot_index));
  let index = 1;
  while (used.has(index)) index++;
  const end = new Date(at); end.setDate(end.getDate() + settings.betWeeks * 7);
  return { ...task, slot, slot_index: inBackpack(task) ? task.slot_index : index, status: '进行中', bet_ends_at: slot === '主线' ? end.toISOString() : null };
}

export function leaveBackpack(task: Task, status: '冷藏' | '已放弃'): Task {
  return { ...task, slot: '不在背包', slot_index: null, status, bet_ends_at: null };
}
