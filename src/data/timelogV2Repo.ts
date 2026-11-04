import { parse, stringify } from 'yaml';
import { z } from 'zod';
import type { TimeEntry } from '../domain/timeline/entry';
import { assertEntries } from '../domain/timeline/entry';
import { activityDay } from '../domain/timeline/day';
import type { FileSystem } from './fs';
import type { Write } from './journal';
import { createWrite, committedWrite } from './journal';

import { entrySchema } from './schemas';


export interface DayChange { day: string; before: TimeEntry[]; after: TimeEntry[] }

export class TimelogV2Repo {
  private index = new Map<string, TimeEntry[]>();
  constructor(private fs: FileSystem) {}
  snapshot(): TimeEntry[] { return [...this.index.values()].flat(); }
  private decode(text: string, path: string): TimeEntry[] {
    try { return z.array(entrySchema).parse(parse(text)); }
    catch (error) { throw new Error(`${path}: invalid v2 timelog`, { cause: error }); }
  }
  async scan(now: string, boundaryHour: number): Promise<TimeEntry[]> {
    const index = new Map<string, TimeEntry[]>();
    for (const path of (await this.fs.list('timelog')).filter(path => path.endsWith('.md'))) {
      const day = path.slice('timelog/'.length, -3); z.iso.date().parse(day);
      const file = await this.fs.read(path);
      if (!file) throw new Error(`Timelog disappeared: ${path}`);
      const entries = this.decode(file.text, path);
      if (entries.some(entry => activityDay(entry.started_at, boundaryHour) !== day)) throw new Error(`${path}: 条目所在活动日错误`);
      index.set(day, entries);
    }
    const entries = [...index.values()].flat(); assertEntries(entries, now);
    this.index = index; return entries;
  }
  between(start: string, end: string): TimeEntry[] {
    return this.snapshot().filter(entry => Date.parse(entry.started_at) < Date.parse(end) &&
      (entry.ended_at === null || Date.parse(entry.ended_at) > Date.parse(start)));
  }
  private group(entries: readonly TimeEntry[], boundaryHour: number): Map<string, TimeEntry[]> {
    const groups = new Map<string, TimeEntry[]>();
    for (const entry of entries) {
      const day = activityDay(entry.started_at, boundaryHour);
      const group = groups.get(day);
      if (group) group.push(entry);
      else groups.set(day, [entry]);
    }
    return groups;
  }
  /**
   * 与已提交索引相比，本次改动了哪些活动日、每天改前改后的条目（ADR 0019 第 4 条）。
   * 判定与 writes() 相同：按开始时刻的活动日分组后逐日比较。返回的是独立副本。
   */
  changedDays(entries: readonly TimeEntry[], boundaryHour: number): DayChange[] {
    // 和 writes() 一样先过 schema，键的顺序一致，比较结果才与实际写盘一致。
    const groups = this.group(z.array(entrySchema).parse(entries), boundaryHour), changes: DayChange[] = [];
    for (const day of new Set([...this.index.keys(), ...groups.keys()])) {
      const before = this.index.get(day) ?? [], after = groups.get(day) ?? [];
      if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ day, before: structuredClone(before), after: structuredClone(after) });
    }
    return changes.sort((a, b) => a.day.localeCompare(b.day));
  }
  async writes(entries: readonly TimeEntry[], now: string, boundaryHour: number): Promise<Write[]> {
    const valid = z.array(entrySchema).parse(entries); assertEntries(valid, now);
    const groups = this.group(valid, boundaryHour);
    const writes: Write[] = [];
    for (const day of new Set([...this.index.keys(), ...groups.keys()])) {
      const beforeEntries = this.index.get(day) ?? [], next = groups.get(day) ?? [];
      if (JSON.stringify(beforeEntries) === JSON.stringify(next)) continue;
      const path = `timelog/${day}.md`, file = await this.fs.read(path);
      if (JSON.stringify(file ? this.decode(file.text, path) : []) !== JSON.stringify(beforeEntries)) throw new Error(`External edit: ${path}`);
      writes.push(createWrite(path, next.length ? stringify(next) : null, file?.text ?? null));
    }
    return writes;
  }
  acceptCommitted(writes: Write[]): void {
    for (const write of writes.map(committedWrite)) {
      const match = /^timelog\/(\d{4}-\d{2}-\d{2})\.md$/.exec(write.path);
      if (!match) continue;
      if (write.text === null) this.index.delete(match[1]);
      else this.index.set(match[1], this.decode(write.text, write.path));
    }
  }
}
