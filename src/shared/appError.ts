import { z } from 'zod';
import { jsonValue } from './operation.ts';

/** Transport-independent application failure; callers never need to parse an error message. */
export const applicationErrorSchema = z.strictObject({
  status: z.literal('error'), code: z.string().min(1),
  category: z.enum(['not_executed', 'result_unknown']),
  message: z.string(), next_step: z.string(),
  latest_context: jsonValue.optional(),
});
export type ApplicationFailure = z.infer<typeof applicationErrorSchema>;

export class ApplicationError extends Error {
  readonly failure: ApplicationFailure;
  constructor(failure: ApplicationFailure, cause?: unknown) {
    super(failure.message, { cause });
    this.name = 'ApplicationError';
    this.failure = applicationErrorSchema.parse(failure);
  }
}

export function applicationFailure(error: unknown): ApplicationFailure {
  if (error instanceof ApplicationError) return error.failure;
  const message = error instanceof Error ? error.message : String(error);
  const code = /^([A-Z][A-Z0-9_]+)[：:]/.exec(message)?.[1] ?? 'EXECUTION_FAILED';
  const unknown = ['RESULT_UNKNOWN', 'HOST_LOST', 'JOURNAL_BLOCKED', 'SNAPSHOT_UNAVAILABLE', 'CANCELLED_AFTER_SEND', 'INVALID_COMMITTED_RECEIPT'].includes(code);
  return {
    status: 'error', code, category: unknown ? 'result_unknown' : 'not_executed', message,
    next_step: unknown ? '请使用原 operation_id 核对 get_operation_result；不要换 ID 重复提交' : '请根据错误说明修正参数或检查应用状态后重试',
  };
}
