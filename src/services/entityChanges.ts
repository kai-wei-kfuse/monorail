import type { Entity, EntityRepo, RecordEntityRepo, RecordSummary, Write } from '../data/repos';
import { bodyDigest, computeRecordRevision, normalizeBody } from '../domain/record/record';
import type { RecordEntry } from '../domain/record/record';
import type { CapturedRecord } from '../domain/history/compare';
import { canonicalJson } from '../shared/operation';
import type { JsonValue } from '../shared/operation';
import { sha256Hex } from '../shared/sha256';

/** Each entity has one final value per transaction; repositories retain conflict checks. */
export function entityChanges<T extends { id: string }>(repo: EntityRepo<T>, entities: Entity<T>[], body?: (value: T, original: Entity<T> | null) => string | undefined) {
  const originals = new Map(entities.map(entity => [entity.value.id, entity]));
  const changed = new Map<string, T | null>();
  /** rebase 之后这些对象的「改前」改用当时的值（快速记录条吸收的改动不算进用户动作；ADR 0019 第 5 条） */
  const baseline = new Map<string, T | null>();
  return {
    values: entities.map(entity => entity.value),
    save(value: T) { changed.set(value.id, value); this.values = [...this.values.filter(item => item.id !== value.id), value]; },
    remove(id: string) {
      if (!this.values.some(value => value.id === id)) throw new Error('记录不存在');
      changed.set(id, null); this.values = this.values.filter(value => value.id !== id);
    },
    /**
     * 本事务保存或删除过的实体及其改前改后（ADR 0019 第 4 条）。改前值从载入时的原文重新解码，
     * 不依赖服务没有就地修改对象；只解码改动过的那几个。保存了但内容没变的也会列出，是否算实质改动由调用方判断。
     */
    changed(): { id: string; before: T | null; after: T | null }[] {
      const list: { id: string; before: T | null; after: T | null }[] = [];
      for (const [id, after] of changed) {
        const original = originals.get(id);
        const before = baseline.has(id) ? baseline.get(id)! : original ? repo.decode(original) : null;
        if (before || after) list.push({ id, before, after: after ? structuredClone(after) : null });
      }
      return list;
    },
    /** 把目前已改动的对象的当前值记为之后 changed() 的改前值。 */
    rebase() { for (const [id, value] of changed) baseline.set(id, value ? structuredClone(value) : null); },
    async writes(): Promise<Write[]> {
      const writes: Write[] = [];
      for (const [id, value] of changed) {
        const original = originals.get(id) ?? null;
        if (value) writes.push(await repo.write(value, original, body?.(value, original)));
        else if (original) writes.push(await repo.remove(original));
      }
      return writes;
    },
  };
}

export function recordChanges(repo: RecordEntityRepo, entities: RecordSummary[]) {
  const originals = new Map(entities.map(entity => [entity.value.id, entity]));
  const currentSummaries = new Map<string, { hasDetails: boolean; detailsDigest: string; recordRevision: string }>(
    entities.map(entity => [entity.value.id, {
      hasDetails: entity.hasDetails,
      detailsDigest: entity.detailsDigest,
      recordRevision: entity.recordRevision,
    }]),
  );
  const changed = new Map<string, { value: RecordEntry | null; detailsPatch?: string }>();
  const baseline = new Map<string, { value: RecordEntry | null; detailsDigest: string }>();
  const knownBodies = new Map<string, string>();

  const computePendingSummary = (value: RecordEntry, detailsPatch: string | undefined, original: RecordSummary | undefined) => {
    if (detailsPatch !== undefined) {
      const normalized = normalizeBody(detailsPatch);
      knownBodies.set(value.id, normalized);
      return {
        hasDetails: normalized.length > 0,
        detailsDigest: bodyDigest(normalized),
        recordRevision: computeRecordRevision({
          id: value.id,
          text: value.text,
          details_markdown: normalized,
          needs: value.needs,
          tags: value.tags,
          attachments: value.attachments,
        }),
      };
    }
    const knownBody = knownBodies.get(value.id);
    if (knownBody !== undefined) {
      return {
        hasDetails: knownBody.length > 0,
        detailsDigest: bodyDigest(knownBody),
        recordRevision: computeRecordRevision({
          id: value.id,
          text: value.text,
          details_markdown: knownBody,
          needs: value.needs,
          tags: value.tags,
          attachments: value.attachments,
        }),
      };
    }
    if (original) {
      if (!original.hasDetails) {
        return {
          hasDetails: false,
          detailsDigest: '',
          recordRevision: computeRecordRevision({
            id: value.id,
            text: value.text,
            details_markdown: '',
            needs: value.needs,
            tags: value.tags,
            attachments: value.attachments,
          }),
        };
      }
      return currentSummaries.get(value.id) ?? {
        hasDetails: original.hasDetails,
        detailsDigest: original.detailsDigest,
        recordRevision: original.recordRevision,
      };
    }
    const fallbackBody = value.kind === '待办' ? normalizeBody(value.text) : '';
    return {
      hasDetails: fallbackBody.length > 0,
      detailsDigest: bodyDigest(fallbackBody),
      recordRevision: computeRecordRevision({
        id: value.id,
        text: value.text,
        details_markdown: fallbackBody,
        needs: value.needs,
        tags: value.tags,
        attachments: value.attachments,
      }),
    };
  };

  return {
    values: entities.map(entity => entity.value),
    save(value: RecordEntry, detailsPatch?: string) {
      const prev = changed.get(value.id);
      const effectivePatch = detailsPatch !== undefined ? detailsPatch : prev?.detailsPatch;
      changed.set(value.id, { value, detailsPatch: effectivePatch });
      this.values = [...this.values.filter(item => item.id !== value.id), value];
      currentSummaries.set(value.id, computePendingSummary(value, effectivePatch, originals.get(value.id)));
    },
    remove(id: string) {
      if (!this.values.some(value => value.id === id)) throw new Error('记录不存在');
      changed.set(id, { value: null });
      this.values = this.values.filter(value => value.id !== id);
      currentSummaries.delete(id);
    },
    summaryOf(id: string) {
      return currentSummaries.get(id) ?? null;
    },
    summaries() {
      return new Map(currentSummaries);
    },
    async readTargetDetails(id: string): Promise<{ body: string; rawBody: string; recordRevision: string; hasDetails: boolean; detailsDigest: string } | null> {
      const pending = changed.get(id);
      if (pending && pending.value === null) return null;
      const original = originals.get(id);
      if (pending && pending.detailsPatch !== undefined && pending.value) {
        const normalized = normalizeBody(pending.detailsPatch);
        const summary = computePendingSummary(pending.value, pending.detailsPatch, original);
        return {
          body: normalized,
          rawBody: pending.detailsPatch,
          recordRevision: summary.recordRevision,
          hasDetails: summary.hasDetails,
          detailsDigest: summary.detailsDigest,
        };
      }
      if (!original) {
        if (pending?.value) {
          const body = pending.value.kind === '待办' ? normalizeBody(pending.value.text) : '';
          const summary = computePendingSummary(pending.value, undefined, undefined);
          return { body, rawBody: body, ...summary };
        }
        return null;
      }
      const detail = await repo.getDetails(id);
      if (
        !detail ||
        detail.version !== original.version ||
        detail.rawFileHash !== original.rawFileHash ||
        sha256Hex(detail.rawBody) !== original.rawBodyHash
      ) {
        throw new Error(`External edit (mtime): records/${id}.md`);
      }
      knownBodies.set(id, detail.body);
      return {
        body: detail.body,
        rawBody: detail.rawBody,
        recordRevision: detail.recordRevision,
        hasDetails: detail.hasDetails,
        detailsDigest: detail.detailsDigest,
      };
    },
    changed(): CapturedRecord[] {
      const list: CapturedRecord[] = [];
      for (const [id, entry] of changed) {
        const original = originals.get(id);
        const base = baseline.get(id);
        const before = base !== undefined ? base.value : original ? repo.decode(original) : null;
        const beforeDetailsDigest = base !== undefined ? base.detailsDigest : (original?.detailsDigest ?? '');
        const after = entry.value ? structuredClone(entry.value) : null;
        const afterDetailsDigest = entry.value ? (currentSummaries.get(id)?.detailsDigest ?? '') : '';
        if (before || after) {
          list.push({ id, before, after, beforeDetailsDigest, afterDetailsDigest });
        }
      }
      return list;
    },
    rebase() {
      for (const [id, entry] of changed) {
        baseline.set(id, {
          value: entry.value ? structuredClone(entry.value) : null,
          detailsDigest: entry.value ? (currentSummaries.get(id)?.detailsDigest ?? '') : '',
        });
      }
    },
    async writes(): Promise<Write[]> {
      const writes: Write[] = [];
      for (const [id, entry] of changed) {
        const original = originals.get(id) ?? null;
        if (entry.value) {
          const sameMetadata = original
            ? canonicalJson(entry.value as unknown as JsonValue) === canonicalJson(original.value as unknown as JsonValue)
            : false;
          const nextDetailsDigest = entry.detailsPatch !== undefined
            ? bodyDigest(entry.detailsPatch)
            : (original?.detailsDigest ?? '');
          const sameBodyDigest = original ? nextDetailsDigest === original.detailsDigest : false;
          if (original && sameMetadata && sameBodyDigest) {
            continue;
          }
          const write = await repo.write(entry.value, original, entry.detailsPatch);
          const preparedSummary = repo.lastPreparedSummary(id);
          if (preparedSummary) {
            currentSummaries.set(id, {
              hasDetails: preparedSummary.hasDetails,
              detailsDigest: preparedSummary.detailsDigest,
              recordRevision: preparedSummary.recordRevision,
            });
          }
          writes.push(write);
        } else if (original) {
          writes.push(await repo.remove(original));
        }
      }
      return writes;
    },
  };
}
