// N2 step 1 changes in-memory terminology only. These mappings keep every v1 disk key intact.
export type FieldNames = Readonly<Record<string, string>>;
export const taskReferenceFields = { project_id: 'task_id' } as const;
export const reviewTaskFields = { bet_project_ids: 'bet_task_ids' } as const;
export const timingProjectFields = { category: 'project' } as const;

function remap(value: unknown, fields: FieldNames, toDisk: boolean): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const output = { ...value } as Record<string, unknown>;
  for (const [disk, memory] of Object.entries(fields)) {
    const from = toDisk ? memory : disk, to = toDisk ? disk : memory;
    if (Object.hasOwn(output, from)) {
      output[to] = output[from];
      delete output[from];
    }
  }
  return output;
}
export const fromV1 = (value: unknown, fields: FieldNames): unknown => remap(value, fields, false);
export const toV1 = (value: unknown, fields: FieldNames): unknown => remap(value, fields, true);

export function settingsV1(value: unknown, toDisk: boolean): unknown {
  if (value === null || typeof value !== 'object' || !('lists' in value)) return value;
  const lists = value.lists;
  if (lists === null || typeof lists !== 'object' || !('quickActivities' in lists) || !Array.isArray(lists.quickActivities)) return value;
  return { ...value, lists: { ...lists, quickActivities: lists.quickActivities.map(item => remap(item, timingProjectFields, toDisk)) } };
}
