import { invoke } from '@tauri-apps/api/core';
export interface Reminder { id: string; at: number; title: string; body: string }
export interface Reminders { update(plans: Reminder[]): Promise<void> }
export const nativeReminders: Reminders = { update: plans => invoke('set_reminders', { plans }) };
