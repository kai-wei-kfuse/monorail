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
