/** Usage is one occurrence per entry, preset or card; explicit unused tags remain selectable. */
export function knownTags(used: readonly { tags: readonly string[] }[], declared: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const item of used) for (const tag of new Set(item.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  for (const tag of declared) if (!counts.has(tag)) counts.set(tag, 0);
  return [...counts].sort(([a, ac], [b, bc]) => bc - ac || a.localeCompare(b)).map(([tag]) => tag);
}
