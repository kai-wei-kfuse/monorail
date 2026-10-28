/** 拖动排序：把 from 挪到 to 现在的位置（往后拖放在它后面，往前拖放在它前面）。找不到或相同时原样返回。 */
export function reorder(ids: readonly string[], from: string, to: string): string[] {
  const i = ids.indexOf(from), j = ids.indexOf(to);
  if (i < 0 || j < 0 || i === j) return [...ids];
  const out = ids.filter(id => id !== from);
  out.splice(j, 0, from);
  return out;
}
