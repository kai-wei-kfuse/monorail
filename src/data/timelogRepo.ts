import { parse, stringify } from 'yaml';
import { z } from 'zod';
import type { Segment } from '../domain/timeline/segment';
import type { FileSystem } from './fs';
import type { Write } from './journal';
import { segmentSchema } from './schemas';

export class TimelogRepo {
  constructor(private fs: FileSystem) {}
  async all(): Promise<Segment[]> {
    const output: Segment[] = [];
    for (const path of (await this.fs.list('timelog')).filter(p => p.endsWith('.md'))) {
      const file = await this.fs.read(path);
      if (!file) throw new Error(`Timelog disappeared: ${path}`);
      try { output.push(...z.array(segmentSchema).parse(parse(file.text))); }
      catch (error) { throw new Error(`${path}: invalid timelog`, { cause: error }); }
    }
    return output;
  }
  async writes(changes: { day: string; segment: Segment }[]): Promise<Write[]> {
    const output: Write[] = [];
    for (const day of new Set(changes.map(c => c.day))) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid activity day');
      const path = `timelog/${day}.md`, before = (await this.fs.read(path))?.text ?? null;
      const segments = before === null ? [] : z.array(segmentSchema).parse(parse(before));
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
      output.push({ path, before, text: stringify(segments) });
    }
    return output;
  }
}
