import type { ApplicationClient } from '../client/applicationClient.ts';
import type { ApplicationMethod, ApplicationOutput, CallerOrigin } from '../src/shared/application.ts';
import { ApplicationError, applicationFailure } from '../src/shared/appError.ts';
import type { ParsedCliCommand } from './commands.ts';

export type CliExecutionOutcome =
  | {
      kind: 'help';
      json: boolean;
      topic?: string;
    }
  | {
      kind: 'version';
      json: boolean;
    }
  | {
      kind: 'ok';
      json: boolean;
      method: ApplicationMethod;
      operationId?: string;
      result: ApplicationOutput<ApplicationMethod>;
    };

export class CliExecutionError extends ApplicationError {
  readonly method?: ApplicationMethod;
  readonly operationId?: string;

  constructor(
    error: unknown,
    meta: { method?: ApplicationMethod; operationId?: string } = {},
  ) {
    const failure = applicationFailure(error);
    const enriched =
      meta.operationId && failure.category === 'result_unknown' && !failure.next_step.includes(meta.operationId)
        ? {
            ...failure,
            next_step: `${failure.next_step}（可执行：monorail operation get ${meta.operationId}）`,
          }
        : failure;
    super(enriched, error);
    this.name = 'CliExecutionError';
    this.method = meta.method;
    this.operationId = meta.operationId;
  }
}

interface ResolvedWriteMeta {
  operationId: string;
  expectedState?: string;
}

async function resolveWriteMeta(
  client: ApplicationClient,
  options: {
    method: ApplicationMethod;
    operationId?: string;
    expectedState?: string;
    needsExpectedState: boolean;
    signal?: AbortSignal;
  },
): Promise<ResolvedWriteMeta> {
  const { method, operationId: explicitOpId, expectedState: explicitState, needsExpectedState, signal } = options;

  if (!explicitOpId) {
    try {
      const ctx = await client.call('get_context', { sections: ['timer'] }, { signal });
      return {
        operationId: ctx.operation_id,
        expectedState: explicitState ?? (needsExpectedState ? ctx.expected_state : undefined),
      };
    } catch (error) {
      throw new CliExecutionError(error, { method });
    }
  }

  // Explicit --operation-id provided: follow §5.2 deterministic retry resolution
  let lookup: ApplicationOutput<'get_operation_result'>;
  try {
    lookup = await client.call('get_operation_result', { operation_id: explicitOpId }, { signal });
  } catch (error) {
    throw new CliExecutionError(error, { method, operationId: explicitOpId });
  }

  if (lookup.status === 'committed') {
    if (!needsExpectedState) {
      return { operationId: explicitOpId };
    }
    if (explicitState !== undefined) {
      return { operationId: explicitOpId, expectedState: explicitState };
    }
    const reqArgs = lookup.request.arguments;
    const receiptExpectedState =
      typeof reqArgs === 'object' &&
      reqArgs !== null &&
      !Array.isArray(reqArgs) &&
      typeof (reqArgs as Record<string, unknown>).expected_state === 'string' &&
      ((reqArgs as Record<string, unknown>).expected_state as string).trim().length > 0
        ? ((reqArgs as Record<string, unknown>).expected_state as string)
        : undefined;

    if (!receiptExpectedState) {
      if (lookup.command !== method) {
        // Different command without expected_state (e.g. save_idea vs start_timer): obtain current context so runOperation rejects with OPERATION_CONFLICT
        try {
          const ctx = await client.call('get_context', { sections: ['timer'] }, { signal });
          return { operationId: explicitOpId, expectedState: ctx.expected_state };
        } catch (error) {
          throw new CliExecutionError(error, { method, operationId: explicitOpId });
        }
      }
      throw new CliExecutionError(
        new ApplicationError({
          status: 'error',
          code: 'RECEIPT_INCOMPLETE',
          category: 'not_executed',
          message: `RECEIPT_INCOMPLETE：操作 ${explicitOpId} 的历史回执缺少原 expected_state，无法安全重建重试`,
          next_step: `请运行 monorail operation get ${explicitOpId} 核对已提交结果，不要使用新状态令牌覆盖重试`,
        }),
        { method, operationId: explicitOpId },
      );
    }
    return { operationId: explicitOpId, expectedState: receiptExpectedState };
  }

  // lookup.status === 'not_found'
  if (!needsExpectedState) {
    return { operationId: explicitOpId };
  }
  if (explicitState !== undefined) {
    return { operationId: explicitOpId, expectedState: explicitState };
  }
  try {
    const ctx = await client.call('get_context', { sections: ['timer'] }, { signal });
    return { operationId: explicitOpId, expectedState: ctx.expected_state };
  } catch (error) {
    throw new CliExecutionError(error, { method, operationId: explicitOpId });
  }
}

/** 这个进程的每次调用都带同一个 origin（CLI 只在启动时识别一次调用方；ADR 0019 第 6 条）。 */
function withOrigin(client: ApplicationClient, origin: CallerOrigin | undefined): ApplicationClient {
  if (!origin) return client;
  return { call: (method, input, callOptions) => client.call(method, input, { ...callOptions, origin: callOptions?.origin ?? origin }) };
}

export async function executeCliCommand(
  cmd: ParsedCliCommand,
  createClient: () => ApplicationClient,
  options: { signal?: AbortSignal; origin?: CallerOrigin } = {},
): Promise<CliExecutionOutcome> {
  if (cmd.kind === 'help') {
    return { kind: 'help', json: cmd.json, topic: cmd.topic };
  }
  if (cmd.kind === 'version') {
    return { kind: 'version', json: cmd.json };
  }

  const client = withOrigin(createClient(), options.origin);
  const { signal } = options;

  switch (cmd.method) {
    case 'get_context': {
      try {
        const result = await client.call(
          'get_context',
          cmd.sections ? { sections: cmd.sections } : {},
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'get_context', result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'get_context' });
      }
    }

    case 'get_operation_result': {
      try {
        const result = await client.call(
          'get_operation_result',
          { operation_id: cmd.operationId },
          { signal },
        );
        return {
          kind: 'ok',
          json: cmd.json,
          method: 'get_operation_result',
          operationId: cmd.operationId,
          result,
        };
      } catch (error) {
        throw new CliExecutionError(error, {
          method: 'get_operation_result',
          operationId: cmd.operationId,
        });
      }
    }

    case 'find_items': {
      try {
        const result = await client.call(
          'find_items',
          {
            ...(cmd.itemKind !== undefined ? { kind: cmd.itemKind } : {}),
            ...(cmd.query !== undefined ? { query: cmd.query } : {}),
            ...(cmd.includeArchived !== undefined ? { include_archived: cmd.includeArchived } : {}),
          },
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'find_items', result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'find_items' });
      }
    }

    case 'get_time_summary': {
      try {
        const result = await client.call(
          'get_time_summary',
          {
            ...(cmd.day !== undefined ? { day: cmd.day } : {}),
            ...(cmd.dayMode !== undefined ? { day_mode: cmd.dayMode } : {}),
          },
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'get_time_summary', result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'get_time_summary' });
      }
    }

    case 'list_time_entries': {
      try {
        const result = await client.call(
          'list_time_entries',
          { from: cmd.from, to: cmd.to },
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'list_time_entries', result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'list_time_entries' });
      }
    }

    case 'save_idea': {
      const meta = await resolveWriteMeta(client, {
        method: 'save_idea',
        operationId: cmd.operationId,
        needsExpectedState: false,
        signal,
      });
      try {
        const result = await client.call(
          'save_idea',
          {
            operation_id: meta.operationId,
            text: cmd.text,
            ...(cmd.needs !== undefined ? { needs: cmd.needs } : {}),
          },
          { signal },
        );
        return {
          kind: 'ok',
          json: cmd.json,
          method: 'save_idea',
          operationId: result.operation_id,
          result,
        };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'save_idea', operationId: meta.operationId });
      }
    }

    case 'capture_todo': {
      const meta = await resolveWriteMeta(client, {
        method: 'capture_todo',
        operationId: cmd.operationId,
        needsExpectedState: false,
        signal,
      });
      try {
        const result = await client.call(
          'capture_todo',
          {
            operation_id: meta.operationId,
            text: cmd.text,
            ...(cmd.taskId !== undefined ? { task_id: cmd.taskId } : {}),
            ...(cmd.dueAt !== undefined ? { due_at: cmd.dueAt } : {}),
            ...(cmd.blocking !== undefined ? { blocking: cmd.blocking } : {}),
          },
          { signal },
        );
        return {
          kind: 'ok',
          json: cmd.json,
          method: 'capture_todo',
          operationId: result.operation_id,
          result,
        };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'capture_todo', operationId: meta.operationId });
      }
    }

    case 'add_time_entry': {
      const meta = await resolveWriteMeta(client, {
        method: 'add_time_entry',
        operationId: cmd.operationId,
        needsExpectedState: false,
        signal,
      });
      try {
        const result = await client.call(
          'add_time_entry',
          {
            operation_id: meta.operationId,
            description: cmd.description,
            start: cmd.start,
            end: cmd.end,
            ...(cmd.project !== undefined ? { project: cmd.project } : {}),
            ...(cmd.tags !== undefined ? { tags: cmd.tags } : {}),
          },
          { signal },
        );
        return {
          kind: 'ok',
          json: cmd.json,
          method: 'add_time_entry',
          operationId: result.operation_id,
          result,
        };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'add_time_entry', operationId: meta.operationId });
      }
    }

    case 'start_timer': {
      const meta = await resolveWriteMeta(client, {
        method: 'start_timer',
        operationId: cmd.operationId,
        expectedState: cmd.expectedState,
        needsExpectedState: true,
        signal,
      });
      try {
        const result = await client.call(
          'start_timer',
          {
            operation_id: meta.operationId,
            expected_state: meta.expectedState!,
            description: cmd.description,
            ...(cmd.project !== undefined ? { project: cmd.project } : {}),
            ...(cmd.tags !== undefined ? { tags: cmd.tags } : {}),
          },
          { signal },
        );
        return {
          kind: 'ok',
          json: cmd.json,
          method: 'start_timer',
          operationId: result.operation_id,
          result,
        };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'start_timer', operationId: meta.operationId });
      }
    }

    case 'start_task_item': {
      const meta = await resolveWriteMeta(client, {
        method: 'start_task_item',
        operationId: cmd.operationId,
        expectedState: cmd.expectedState,
        needsExpectedState: true,
        signal,
      });
      try {
        const result = await client.call(
          'start_task_item',
          {
            operation_id: meta.operationId,
            expected_state: meta.expectedState!,
            card_id: cmd.cardId,
          },
          { signal },
        );
        return {
          kind: 'ok',
          json: cmd.json,
          method: 'start_task_item',
          operationId: result.operation_id,
          result,
        };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'start_task_item', operationId: meta.operationId });
      }
    }

    case 'pause_timer':
    case 'resume_timer':
    case 'stop_timer':
    case 'return_from_break': {
      const meta = await resolveWriteMeta(client, {
        method: cmd.method,
        operationId: cmd.operationId,
        expectedState: cmd.expectedState,
        needsExpectedState: true,
        signal,
      });
      try {
        const result = await client.call(
          cmd.method,
          {
            operation_id: meta.operationId,
            expected_state: meta.expectedState!,
          },
          { signal },
        );
        return {
          kind: 'ok',
          json: cmd.json,
          method: cmd.method,
          operationId: result.operation_id,
          result,
        };
      } catch (error) {
        throw new CliExecutionError(error, { method: cmd.method, operationId: meta.operationId });
      }
    }

    case 'start_break': {
      const meta = await resolveWriteMeta(client, {
        method: 'start_break',
        operationId: cmd.operationId,
        expectedState: cmd.expectedState,
        needsExpectedState: true,
        signal,
      });
      try {
        const result = await client.call(
          'start_break',
          {
            operation_id: meta.operationId,
            expected_state: meta.expectedState!,
            activity: cmd.activity,
          },
          { signal },
        );
        return {
          kind: 'ok',
          json: cmd.json,
          method: 'start_break',
          operationId: result.operation_id,
          result,
        };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'start_break', operationId: meta.operationId });
      }
    }
  }
}
