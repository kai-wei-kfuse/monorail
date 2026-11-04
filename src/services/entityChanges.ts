import type { Entity, EntityRepo, Write } from '../data/repos';

/** Each entity has one final value per transaction; repositories retain conflict checks. */
export function entityChanges<T extends { id: string }>(repo: EntityRepo<T>, entities: Entity<T>[], body?: (value: T, original: Entity<T> | null) => string | undefined) {
  const originals = new Map(entities.map(entity => [entity.value.id, entity]));
  const changed = new Map<string, T | null>();
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
        const before = original ? repo.decode(original) : null;
        if (before || after) list.push({ id, before, after: after ? structuredClone(after) : null });
      }
      return list;
    },
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
