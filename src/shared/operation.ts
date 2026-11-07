import { z } from 'zod';

// Keep the public schema representable as JSON Schema; canonicalization belongs at storage/queue boundaries.
export const operationId = z.uuid();
export const jsonValue = z.json();
export type JsonValue = z.infer<typeof jsonValue>;
export const receiptSchema = z.strictObject({
  version: z.literal(1), operation_id: operationId, command: z.string().min(1),
  input: z.string(), data: jsonValue, committed_at: z.iso.datetime({ offset: true }),
});
export type OperationReceipt = z.infer<typeof receiptSchema>;
export interface Operation { id: string; command: string; input: JsonValue }
export interface CommitWarning { phase: 'onCommitted' | 'settings' | 'projection' | 'reminders' | 'logging'; message: string }
export interface OperationResult<T> {
  status: 'committed'; operation_id: string; data: T; committed_at: string;
  replayed: boolean; warnings: CommitWarning[];
}

/** Stable comparison of already validated JSON input, independent of object key order. */
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
