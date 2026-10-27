import { parse, stringify } from 'yaml';
import { z } from 'zod';
import type { Segment } from '../domain/timeline/segment';
import type { FileSystem } from './fs';
import type { Write } from './journal';
import { createWrite, committedWrite } from './journal';
import { segmentSchema } from './schemas';

export class TimelogRepo {
  private index = new Map<string, Segment[]>();
  constructor(private fs: FileSystem) {}
  snapshot(): Segment[] { return [...this.index.values()].flat(); }
  acceptCommitted(writes: Write[]): void {
    for (const opaque of writes) {
      const write = committedWrite(opaque), match = /^timelog\/(\d{4}-\d{2}-\d{2})\.md$/.exec(write.path);
      if (match) this.index.set(match[1], this.decode(write.text, write.path));
    }
  }
  private path(day: string): string {
    z.iso.date().parse(day);
    return `timelog/${day}.md`;
  }
  private decode(text: string, path: string): Segment[] {
    try { return z.array(segmentSchema).parse(parse(text)); }
    catch (error) { throw new Error(`${path}: invalid timelog`, { cause: error }); }
  }
  async readDay(day: string): Promise<Segment[]> {
    const path = this.path(day), file = await this.fs.read(path);
    const segments = file ? this.decode(file.text, path) : [];
    this.index.set(day, segments);
    return segments;
  }
  async readDays(days: string[]): Promise<Segment[]> {
    return (await Promise.all([...new Set(days)].map(day => this.readDay(day)))).flat();
  }
  /** Startup audit only. User actions must select their required dates. */
  async scan(): Promise<{ day: string; segments: Segment[] }[]> {
    const paths = (await this.fs.list('timelog')).filter(p => p.endsWith('.md'));
    const days = await Promise.all(paths.map(async path => {
      const day = path.slice('timelog/'.length, -3);
      this.path(day);
      const file = await this.fs.read(path);
      if (!file) throw new Error(`Timelog disappeared: ${path}`);
      return { day, segments: this.decode(file.text, path) };
    }));
    this.index = new Map(days.map(item => [item.day, item.segments]));
    return days;
  }
  async writes(changes: { day: string; segment: Segment }[]): Promise<Write[]> {
    const output: Write[] = [];
    for (const day of new Set(changes.map(c => c.day))) {
      const path = this.path(day), before = (await this.fs.read(path))?.text ?? null;
      const segments = before === null ? [] : this.decode(before, path);
      for (const { segment } of changes.filter(c => c.day === day)) {
        const index = segments.findIndex(s => s.id === segment.id);
        if (index < 0) segments.push(segment);
        else {
          const old = segments[index];
          if (old.ended_at !== null || JSON.stringify({ ...old, ended_at: segment.ended_at }) !== JSON.stringify(segmentSchema.parse(segment))) {
            throw new Error(`History mutation rejected: ${segment.id}`);
          }
          segments[index] = segment;
        }
      }
      output.push(createWrite(path, stringify(segments), before));
    }
    return output;
  }
}
