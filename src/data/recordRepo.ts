import type { z } from 'zod';
import { bodyDigest, computeRecordRevision, normalizeBody } from '../domain/record/record';
import type { RecordEntry } from '../domain/record/record';
import { sha256Hex } from '../shared/sha256';
import type { FileSystem } from './fs';
import { encode, splitRecordFrontmatter } from './frontmatter';
import type { Write } from './journal';
import { createWrite } from './journal';

export interface RecordSummary {
  value: RecordEntry;
  version: string;
  rawFileHash: string;
  rawBodyHash: string;
  hasDetails: boolean;
  detailsDigest: string;
  recordRevision: string;
  headerMeta: Record<string, unknown>;
}

export interface RecordDetail extends RecordSummary {
  body: string;
  rawBody: string;
  text: string;
}

export class RecordRepo {
  private cache = new Map<string, RecordSummary>();
  constructor(private fs: FileSystem, private directory: string, private schema: z.ZodType<RecordEntry>) {}

  path(id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid entity ID');
    return `${this.directory}/${id}.md`;
  }

  private buildSummary(
    meta: Record<string, unknown>,
    rawBody: string,
    normalizedBody: string,
    version: string,
    rawFileHash: string,
    path: string,
  ): RecordSummary {
    let value: RecordEntry;
    try {
      value = this.schema.parse(meta);
    } catch (error) {
      throw new Error(`${path}: invalid entity`, { cause: error });
    }
    const rawBodyHash = sha256Hex(rawBody);
    const hasDetails = rawBody.length > 0;
    const detailsDigest = bodyDigest(normalizedBody);
    const recordRevision = computeRecordRevision({
      id: value.id,
      text: value.text,
      details_markdown: normalizedBody,
      needs: value.needs,
      tags: value.tags,
      attachments: value.attachments,
    });
    return {
      value,
      version,
      rawFileHash,
      rawBodyHash,
      hasDetails,
      detailsDigest,
      recordRevision,
      headerMeta: structuredClone(meta),
    };
  }

  private cloneSummary(summary: RecordSummary): RecordSummary {
    return {
      ...summary,
      value: structuredClone(summary.value),
      headerMeta: structuredClone(summary.headerMeta),
    };
  }

  async get(id: string): Promise<RecordSummary | null> {
    const path = this.path(id);
    const file = await this.fs.read(path);
    if (!file) {
      this.cache.delete(id);
      return null;
    }
    const rawFileHash = file.byteHash ?? sha256Hex(file.text);
    const cached = this.cache.get(id);
    if (cached && cached.version === file.version && cached.rawFileHash === rawFileHash) {
      return this.cloneSummary(cached);
    }
    this.cache.delete(id);
    const { meta, rawBody, normalizedBody } = splitRecordFrontmatter(file.text, path);
    const summary = this.buildSummary(meta, rawBody, normalizedBody, file.version, rawFileHash, path);
    this.cache.set(id, this.cloneSummary(summary));
    return summary;
  }

  async getDetails(id: string): Promise<RecordDetail | null> {
    const path = this.path(id);
    const file = await this.fs.read(path);
    if (!file) {
      this.cache.delete(id);
      return null;
    }
    const rawFileHash = file.byteHash ?? sha256Hex(file.text);
    const { meta, rawBody, normalizedBody } = splitRecordFrontmatter(file.text, path);
    const summary = this.buildSummary(meta, rawBody, normalizedBody, file.version, rawFileHash, path);
    this.cache.set(id, this.cloneSummary(summary));
    return {
      ...summary,
      body: normalizedBody,
      rawBody,
      text: file.text,
    };
  }

  async list(): Promise<RecordSummary[]> {
    const paths = (await this.fs.list(this.directory)).filter(path => path.endsWith('.md'));
    const ids = new Set(paths.map(path => path.slice(this.directory.length + 1, -3)));
    for (const id of this.cache.keys()) {
      if (!ids.has(id)) this.cache.delete(id);
    }
    return Promise.all(paths.map(async path => {
      const id = path.slice(this.directory.length + 1, -3);
      const summary = await this.get(id);
      if (!summary) throw new Error(`Entity disappeared: ${path}`);
      return summary;
    }));
  }

  async prepareWrite(
    value: RecordEntry,
    original: RecordSummary | null,
    bodyPatch?: string,
  ): Promise<{ write: Write; summary: RecordSummary; noop: boolean }> {
    const path = this.path(value.id);
    const current = await this.fs.read(path);
    const currentHash = current ? (current.byteHash ?? sha256Hex(current.text)) : null;
    if (
      (current?.version ?? null) !== (original?.version ?? null) ||
      currentHash !== (original?.rawFileHash ?? null)
    ) {
      throw new Error(`External edit (mtime): ${path}`);
    }

    let rawBodyToWrite: string;
    let normalizedFinalBody: string;
    if (!original) {
      if (value.kind === '想法') {
        normalizedFinalBody = normalizeBody(bodyPatch ?? '');
        rawBodyToWrite = normalizedFinalBody;
      } else {
        rawBodyToWrite = bodyPatch !== undefined ? bodyPatch : value.text;
        normalizedFinalBody = normalizeBody(rawBodyToWrite);
      }
    } else {
      const currentSplit = splitRecordFrontmatter(current!.text, path);
      if (sha256Hex(currentSplit.rawBody) !== original.rawBodyHash) {
        throw new Error(`External edit (mtime): ${path}`);
      }
      if (value.kind === '想法') {
        if (bodyPatch === undefined) {
          rawBodyToWrite = currentSplit.rawBody;
          normalizedFinalBody = currentSplit.normalizedBody;
        } else {
          const normalizedPatch = normalizeBody(bodyPatch);
          if (normalizedPatch === currentSplit.normalizedBody) {
            rawBodyToWrite = currentSplit.rawBody;
            normalizedFinalBody = currentSplit.normalizedBody;
          } else {
            rawBodyToWrite = normalizedPatch;
            normalizedFinalBody = normalizedPatch;
          }
        }
      } else {
        if (bodyPatch !== undefined) {
          rawBodyToWrite = bodyPatch;
        } else if (value.text !== original.value.text) {
          rawBodyToWrite = value.text;
        } else {
          rawBodyToWrite = currentSplit.rawBody;
        }
        normalizedFinalBody = normalizeBody(rawBodyToWrite);
      }
    }

    const meta: Record<string, unknown> = { ...(original ? original.headerMeta : {}), ...value };
    let parsedValue: RecordEntry;
    try {
      parsedValue = this.schema.parse(meta);
    } catch (error) {
      throw new Error(`${path}: invalid entity`, { cause: error });
    }
    const nextText = encode(meta, rawBodyToWrite);
    const summary: RecordSummary = {
      value: parsedValue,
      version: original?.version ?? '0',
      rawFileHash: sha256Hex(nextText),
      rawBodyHash: sha256Hex(rawBodyToWrite),
      hasDetails: rawBodyToWrite.length > 0,
      detailsDigest: bodyDigest(normalizedFinalBody),
      recordRevision: computeRecordRevision({
        id: parsedValue.id,
        text: parsedValue.text,
        details_markdown: normalizedFinalBody,
        needs: parsedValue.needs,
        tags: parsedValue.tags,
        attachments: parsedValue.attachments,
      }),
      headerMeta: structuredClone(meta),
    };
    this.preparedSummaries.set(value.id, summary);
    return {
      write: createWrite(path, nextText, current?.text ?? null),
      summary,
      noop: Boolean(original && current && nextText === current.text),
    };
  }

  private readonly preparedSummaries = new Map<string, RecordSummary>();

  lastPreparedSummary(id: string): RecordSummary | undefined {
    return this.preparedSummaries.get(id);
  }

  async write(value: RecordEntry, original: RecordSummary | null, bodyPatch?: string): Promise<Write> {
    return (await this.prepareWrite(value, original, bodyPatch)).write;
  }

  decode(entity: RecordSummary): RecordEntry {
    const path = this.path(entity.value.id);
    try {
      return this.schema.parse(structuredClone(entity.headerMeta));
    } catch (error) {
      throw new Error(`${path}: invalid entity`, { cause: error });
    }
  }

  async remove(original: RecordSummary): Promise<Write> {
    const path = this.path(original.value.id);
    const current = await this.fs.read(path);
    const currentHash = current ? (current.byteHash ?? sha256Hex(current.text)) : null;
    if (current?.version !== original.version || currentHash !== original.rawFileHash) {
      throw new Error(`External edit (mtime): ${path}`);
    }
    return createWrite(path, null, current.text);
  }
}
