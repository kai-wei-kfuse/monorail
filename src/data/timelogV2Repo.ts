import { parse, stringify } from 'yaml';
import { z } from 'zod';
import type { TimeEntry } from '../domain/timeline/entry';
import { assertEntries } from '../domain/timeline/entry';
import { activityDay } from '../domain/timeline/day';
import type { FileSystem } from './fs';
import type { Write } from './journal';
import { createWrite, committedWrite } from './journal';

import { entrySchema } from './schemas';


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
  async writes(entries: readonly TimeEntry[], now: string, boundaryHour: number): Promise<Write[]> {
    const valid = z.array(entrySchema).parse(entries); assertEntries(valid, now);
    const groups = new Map<string, TimeEntry[]>();
    for (const entry of valid) {
      const day = activityDay(entry.started_at, boundaryHour);
      groups.set(day, [...(groups.get(day) ?? []), entry]);
    }
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
