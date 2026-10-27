import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
export interface PowerEvent { kind: string; at: number; simulated: boolean; suspended_at: number | null; resumed_at: number | null }
export interface Lifecycle { last_alive: number; previous_last_alive: number | null; startup_at: number; events: PowerEvent[] }
export interface LifecycleSource { read(): Promise<Lifecycle>; onPower(handler: (event: PowerEvent) => void): Promise<() => void> }
export const readLifecycle = (): Promise<Lifecycle> => invoke('read_lifecycle');
export const nativeLifecycle: LifecycleSource = {
  read: readLifecycle,
  onPower: handler => listen<PowerEvent>('power-event', event => handler(event.payload)),
};
