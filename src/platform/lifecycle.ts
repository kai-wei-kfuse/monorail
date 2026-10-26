import { invoke } from '@tauri-apps/api/core';
export interface Lifecycle { last_alive: number; previous_last_alive: number | null; startup_at: number; events: { kind: string; at: number; simulated: boolean; suspended_at: number | null; resumed_at: number | null }[] }
export const readLifecycle = (): Promise<Lifecycle> => invoke('read_lifecycle');
