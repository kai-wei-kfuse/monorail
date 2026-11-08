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

type ExpectedStateMode = 'none' | 'required' | 'optional';

async function resolveWriteMeta(
  client: ApplicationClient,
  options: {
    method: ApplicationMethod;
    operationId?: string;
    expectedState?: string;
    expectedStateMode: ExpectedStateMode;
    signal?: AbortSignal;
  },
): Promise<ResolvedWriteMeta> {
  const { method, operationId: explicitOpId, expectedState: explicitState, expectedStateMode, signal } = options;

  if (!explicitOpId) {
    try {
      const ctx = await client.call('get_context', { sections: ['timer'] }, { signal });
      return {
        operationId: ctx.operation_id,
        expectedState:
          explicitState ?? (expectedStateMode === 'none' ? undefined : ctx.expected_state),
      };
    } catch (error) {
      throw new CliExecutionError(error, { method });
    }
  }

  // Explicit --operation-id provided: follow §5.2 & ADR 0023 §2 deterministic retry resolution
  let lookup: ApplicationOutput<'get_operation_result'>;
  try {
    lookup = await client.call('get_operation_result', { operation_id: explicitOpId }, { signal });
  } catch (error) {
    throw new CliExecutionError(error, { method, operationId: explicitOpId });
  }

  if (lookup.status === 'committed') {
    if (expectedStateMode === 'none') {
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

    if (expectedStateMode === 'optional') {
      // ADR 0023 §2：optional 方法重放时，回执有 expected_state 就还原原字符串，没有就保持省略；
      // 不能抛 RECEIPT_INCOMPLETE 或补当前令牌。
      return {
        operationId: explicitOpId,
        ...(receiptExpectedState !== undefined ? { expectedState: receiptExpectedState } : {}),
      };
    }

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
  if (expectedStateMode === 'none') {
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

interface ResolvedIdeaRevisionWriteMeta {
  operationId: string;
  recordRevision: string;
}

/**
 * ADR 0026 §record_revision & ADR 0029 §CLI 格式与长文：
 * update_idea / convert_idea_to_task 共用的操作 ID 与 record_revision 解析流程：
 * - 未显式传 --operation-id：
 *   - 若已显式传 --record-revision：调用 get_context 取 operation_id，保留用户显式修订令牌。
 *   - 若未传 --record-revision：调用 get_idea_details(idea_id) 一次性取得 operation_id 与当前 record_revision。
 * - 显式传了 --operation-id（重试路径）：
 *   - 先调用 get_operation_result(operation_id)；
 *   - 若已 committed 且用户未显式传 --record-revision：仅从同方法回执 request.arguments.record_revision 恢复原修订令牌，
 *     同时保留本次命令行业务参数以参与幂等重放与 OPERATION_CONFLICT 比对；
 *   - 若回执为 not_found 且未显式传 --record-revision：再调用 get_idea_details(idea_id) 取得当前修订令牌。
 */
async function resolveIdeaRevisionWriteMeta(
  client: ApplicationClient,
  options: {
    method: 'update_idea' | 'convert_idea_to_task';
    ideaId: string;
    operationId?: string;
    recordRevision?: string;
    signal?: AbortSignal;
  },
): Promise<ResolvedIdeaRevisionWriteMeta> {
  const { method, ideaId, operationId: explicitOpId, recordRevision: explicitRev, signal } = options;

  if (!explicitOpId) {
    if (explicitRev !== undefined) {
      try {
        const ctx = await client.call('get_context', { sections: ['timer'] }, { signal });
        return { operationId: ctx.operation_id, recordRevision: explicitRev };
      } catch (error) {
        throw new CliExecutionError(error, { method });
      }
    }
    try {
      const details = await client.call('get_idea_details', { idea_id: ideaId }, { signal });
      return {
        operationId: details.operation_id,
        recordRevision: details.idea.record_revision,
      };
    } catch (error) {
      throw new CliExecutionError(error, { method });
    }
  }

  let lookup: ApplicationOutput<'get_operation_result'>;
  try {
    lookup = await client.call('get_operation_result', { operation_id: explicitOpId }, { signal });
  } catch (error) {
    throw new CliExecutionError(error, { method, operationId: explicitOpId });
  }

  if (explicitRev !== undefined) {
    return { operationId: explicitOpId, recordRevision: explicitRev };
  }

  if (lookup.status === 'committed') {
    const reqArgs = lookup.request.arguments;
    const receiptRev =
      lookup.command === method &&
      typeof reqArgs === 'object' &&
      reqArgs !== null &&
      !Array.isArray(reqArgs) &&
      typeof (reqArgs as Record<string, unknown>).record_revision === 'string' &&
      ((reqArgs as Record<string, unknown>).record_revision as string).trim().length > 0
        ? ((reqArgs as Record<string, unknown>).record_revision as string)
        : undefined;
    if (receiptRev !== undefined) {
      return { operationId: explicitOpId, recordRevision: receiptRev };
    }
    if (lookup.command !== method) {
      throw new CliExecutionError(
        new ApplicationError({
          status: 'error',
          code: 'OPERATION_CONFLICT',
          category: 'not_executed',
          message: `OPERATION_CONFLICT：操作 ${explicitOpId} 已用于不同请求（${lookup.command}）`,
          next_step: '该 operation_id 已绑定到另一条不同请求；新操作请省略 --operation-id 或使用新的 operation_id',
        }),
        { method, operationId: explicitOpId },
      );
    }
    throw new CliExecutionError(
      new ApplicationError({
        status: 'error',
        code: 'RECEIPT_INCOMPLETE',
        category: 'not_executed',
        message: `RECEIPT_INCOMPLETE：操作 ${explicitOpId} 的历史回执缺少原 record_revision，无法安全重建重试`,
        next_step: `请运行 monorail operation get ${explicitOpId} 核对已提交结果，不要盲目覆盖重试`,
      }),
      { method, operationId: explicitOpId },
    );
  }

  try {
    const details = await client.call('get_idea_details', { idea_id: ideaId }, { signal });
    return { operationId: explicitOpId, recordRevision: details.idea.record_revision };
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
        expectedStateMode: 'none',
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

    case 'complete_idea': {
      const meta = await resolveWriteMeta(client, {
        method: 'complete_idea',
        operationId: cmd.operationId,
        expectedStateMode: 'none',
        signal,
      });
      try {
        const result = await client.call('complete_idea', { operation_id: meta.operationId, idea_id: cmd.ideaId }, { signal });
        return { kind: 'ok', json: cmd.json, method: 'complete_idea', operationId: result.operation_id, result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'complete_idea', operationId: meta.operationId });
      }
    }

    case 'reopen_idea': {
      const meta = await resolveWriteMeta(client, {
        method: 'reopen_idea',
        operationId: cmd.operationId,
        expectedStateMode: 'none',
        signal,
      });
      try {
        const result = await client.call('reopen_idea', { operation_id: meta.operationId, idea_id: cmd.ideaId }, { signal });
        return { kind: 'ok', json: cmd.json, method: 'reopen_idea', operationId: result.operation_id, result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'reopen_idea', operationId: meta.operationId });
      }
    }

    case 'create_idea': {
      const meta = await resolveWriteMeta(client, {
        method: 'create_idea',
        operationId: cmd.operationId,
        expectedStateMode: 'none',
        signal,
      });
      try {
        const result = await client.call(
          'create_idea',
          {
            operation_id: meta.operationId,
            title: cmd.title,
            ...(cmd.detailsMarkdown !== undefined ? { details_markdown: cmd.detailsMarkdown } : {}),
            ...(cmd.needs !== undefined ? { needs: cmd.needs } : {}),
          },
          { signal },
        );
        return {
          kind: 'ok',
          json: cmd.json,
          method: 'create_idea',
          operationId: result.operation_id,
          result,
        };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'create_idea', operationId: meta.operationId });
      }
    }

    case 'get_idea_details': {
      try {
        const result = await client.call('get_idea_details', { idea_id: cmd.ideaId }, { signal });
        return { kind: 'ok', json: cmd.json, method: 'get_idea_details', result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'get_idea_details' });
      }
    }

    case 'update_idea': {
      const meta = await resolveIdeaRevisionWriteMeta(client, {
        method: 'update_idea',
        ideaId: cmd.ideaId,
        operationId: cmd.operationId,
        recordRevision: cmd.recordRevision,
        signal,
      });
      try {
        const result = await client.call(
          'update_idea',
          {
            operation_id: meta.operationId,
            idea_id: cmd.ideaId,
            record_revision: meta.recordRevision,
            ...(cmd.title !== undefined ? { title: cmd.title } : {}),
            ...(cmd.detailsMarkdown !== undefined ? { details_markdown: cmd.detailsMarkdown } : {}),
            ...(cmd.needs !== undefined ? { needs: cmd.needs } : {}),
          },
          { signal },
        );
        return {
          kind: 'ok',
          json: cmd.json,
          method: 'update_idea',
          operationId: result.operation_id,
          result,
        };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'update_idea', operationId: meta.operationId });
      }
    }

    case 'convert_idea_to_task': {
      const meta = await resolveIdeaRevisionWriteMeta(client, {
        method: 'convert_idea_to_task',
        ideaId: cmd.ideaId,
        operationId: cmd.operationId,
        recordRevision: cmd.recordRevision,
        signal,
      });
      try {
        const result = await client.call(
          'convert_idea_to_task',
          {
            operation_id: meta.operationId,
            idea_id: cmd.ideaId,
            record_revision: meta.recordRevision,
            target: cmd.target,
            items: cmd.items,
          },
          { signal },
        );
        return {
          kind: 'ok',
          json: cmd.json,
          method: 'convert_idea_to_task',
          operationId: result.operation_id,
          result,
        };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'convert_idea_to_task', operationId: meta.operationId });
      }
    }

    case 'create_task': {
      const meta = await resolveWriteMeta(client, {
        method: 'create_task',
        operationId: cmd.operationId,
        expectedStateMode: 'none',
        signal,
      });
      try {
        const result = await client.call(
          'create_task',
          {
            operation_id: meta.operationId,
            name: cmd.name,
            slot: cmd.slot,
            ...(cmd.defaultProject !== undefined ? { default_project: cmd.defaultProject } : {}),
            ...(cmd.items !== undefined ? { items: cmd.items } : {}),
          },
          { signal },
        );
        return {
          kind: 'ok',
          json: cmd.json,
          method: 'create_task',
          operationId: result.operation_id,
          result,
        };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'create_task', operationId: meta.operationId });
      }
    }

    case 'capture_todo': {
      const meta = await resolveWriteMeta(client, {
        method: 'capture_todo',
        operationId: cmd.operationId,
        expectedStateMode: 'none',
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
        expectedStateMode: 'none',
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

    case 'update_time_entry': {
      const meta = await resolveWriteMeta(client, {
        method: 'update_time_entry',
        operationId: cmd.operationId,
        expectedState: cmd.expectedState,
        expectedStateMode: 'required',
        signal,
      });
      try {
        const result = await client.call(
          'update_time_entry',
          {
            operation_id: meta.operationId,
            expected_state: meta.expectedState!,
            entry_id: cmd.entryId,
            ...(cmd.start !== undefined ? { start: cmd.start } : {}),
            ...(cmd.end !== undefined ? { end: cmd.end } : {}),
            ...(cmd.description !== undefined ? { description: cmd.description } : {}),
            ...(cmd.project !== undefined ? { project: cmd.project } : {}),
            ...(cmd.tags !== undefined ? { tags: cmd.tags } : {}),
          },
          { signal },
        );
        return {
          kind: 'ok',
          json: cmd.json,
          method: 'update_time_entry',
          operationId: result.operation_id,
          result,
        };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'update_time_entry', operationId: meta.operationId });
      }
    }

    case 'start_timer': {
      const meta = await resolveWriteMeta(client, {
        method: 'start_timer',
        operationId: cmd.operationId,
        expectedState: cmd.expectedState,
        expectedStateMode: 'required',
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
        expectedStateMode: 'required',
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
    case 'return_from_break':
    case 'end_original_task': {
      const meta = await resolveWriteMeta(client, {
        method: cmd.method,
        operationId: cmd.operationId,
        expectedState: cmd.expectedState,
        expectedStateMode: 'required',
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
        expectedStateMode: 'required',
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

    case 'get_task_plan': {
      try {
        const result = await client.call(
          'get_task_plan',
          cmd.day !== undefined ? { day: cmd.day } : {},
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'get_task_plan', result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'get_task_plan' });
      }
    }

    case 'add_plan_item': {
      const meta = await resolveWriteMeta(client, {
        method: 'add_plan_item',
        operationId: cmd.operationId,
        expectedStateMode: 'none',
        signal,
      });
      try {
        const result = await client.call(
          'add_plan_item',
          {
            operation_id: meta.operationId,
            day: cmd.day,
            card_id: cmd.cardId,
            ...(cmd.priority !== undefined ? { priority: cmd.priority } : {}),
            ...(cmd.todayMinutes !== undefined ? { today_minutes: cmd.todayMinutes } : {}),
          },
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'add_plan_item', operationId: result.operation_id, result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'add_plan_item', operationId: meta.operationId });
      }
    }

    case 'remove_plan_item': {
      const meta = await resolveWriteMeta(client, {
        method: 'remove_plan_item',
        operationId: cmd.operationId,
        expectedStateMode: 'none',
        signal,
      });
      try {
        const result = await client.call(
          'remove_plan_item',
          {
            operation_id: meta.operationId,
            day: cmd.day,
            card_id: cmd.cardId,
          },
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'remove_plan_item', operationId: result.operation_id, result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'remove_plan_item', operationId: meta.operationId });
      }
    }

    case 'update_plan_item': {
      const meta = await resolveWriteMeta(client, {
        method: 'update_plan_item',
        operationId: cmd.operationId,
        expectedStateMode: 'none',
        signal,
      });
      try {
        const result = await client.call(
          'update_plan_item',
          {
            operation_id: meta.operationId,
            day: cmd.day,
            card_id: cmd.cardId,
            ...(cmd.priority !== undefined ? { priority: cmd.priority } : {}),
            ...(cmd.todayMinutes !== undefined ? { today_minutes: cmd.todayMinutes } : {}),
          },
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'update_plan_item', operationId: result.operation_id, result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'update_plan_item', operationId: meta.operationId });
      }
    }

    case 'confirm_plan_carry': {
      const meta = await resolveWriteMeta(client, {
        method: 'confirm_plan_carry',
        operationId: cmd.operationId,
        expectedStateMode: 'none',
        signal,
      });
      try {
        const result = await client.call(
          'confirm_plan_carry',
          {
            operation_id: meta.operationId,
            day: cmd.day,
            keep_card_ids: cmd.keepCardIds,
          },
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'confirm_plan_carry', operationId: result.operation_id, result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'confirm_plan_carry', operationId: meta.operationId });
      }
    }

    case 'skip_today_plan': {
      const meta = await resolveWriteMeta(client, {
        method: 'skip_today_plan',
        operationId: cmd.operationId,
        expectedStateMode: 'none',
        signal,
      });
      try {
        const result = await client.call(
          'skip_today_plan',
          {
            operation_id: meta.operationId,
            day: cmd.day,
          },
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'skip_today_plan', operationId: result.operation_id, result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'skip_today_plan', operationId: meta.operationId });
      }
    }

    case 'draw_task_item': {
      try {
        const result = await client.call('draw_task_item', {}, { signal });
        return { kind: 'ok', json: cmd.json, method: 'draw_task_item', result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'draw_task_item' });
      }
    }

    case 'skip_task_item': {
      const meta = await resolveWriteMeta(client, {
        method: 'skip_task_item',
        operationId: cmd.operationId,
        expectedStateMode: 'none',
        signal,
      });
      try {
        const result = await client.call(
          'skip_task_item',
          {
            operation_id: meta.operationId,
            day: cmd.day,
            card_id: cmd.cardId,
          },
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'skip_task_item', operationId: result.operation_id, result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'skip_task_item', operationId: meta.operationId });
      }
    }

    case 'complete_task_item': {
      const meta = await resolveWriteMeta(client, {
        method: 'complete_task_item',
        operationId: cmd.operationId,
        expectedState: cmd.expectedState,
        expectedStateMode: 'optional',
        signal,
      });
      try {
        const result = await client.call(
          'complete_task_item',
          {
            operation_id: meta.operationId,
            ...(meta.expectedState !== undefined ? { expected_state: meta.expectedState } : {}),
            card_id: cmd.cardId,
            ...(cmd.note !== undefined ? { note: cmd.note } : {}),
            ...(cmd.finishEarly !== undefined ? { finish_early: cmd.finishEarly } : {}),
          },
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'complete_task_item', operationId: result.operation_id, result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'complete_task_item', operationId: meta.operationId });
      }
    }

    case 'reopen_task_item': {
      const meta = await resolveWriteMeta(client, {
        method: 'reopen_task_item',
        operationId: cmd.operationId,
        expectedState: cmd.expectedState,
        expectedStateMode: 'optional',
        signal,
      });
      try {
        const result = await client.call(
          'reopen_task_item',
          {
            operation_id: meta.operationId,
            ...(meta.expectedState !== undefined ? { expected_state: meta.expectedState } : {}),
            card_id: cmd.cardId,
            ...(cmd.makeRoom !== undefined ? { make_room: cmd.makeRoom } : {}),
          },
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'reopen_task_item', operationId: result.operation_id, result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'reopen_task_item', operationId: meta.operationId });
      }
    }

    case 'keep_going_task_item': {
      const meta = await resolveWriteMeta(client, {
        method: 'keep_going_task_item',
        operationId: cmd.operationId,
        expectedState: cmd.expectedState,
        expectedStateMode: 'required',
        signal,
      });
      try {
        const result = await client.call(
          'keep_going_task_item',
          {
            operation_id: meta.operationId,
            expected_state: meta.expectedState!,
            card_id: cmd.cardId,
            ...(cmd.note !== undefined ? { note: cmd.note } : {}),
          },
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'keep_going_task_item', operationId: result.operation_id, result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'keep_going_task_item', operationId: meta.operationId });
      }
    }

    case 'split_task_item': {
      const meta = await resolveWriteMeta(client, {
        method: 'split_task_item',
        operationId: cmd.operationId,
        expectedState: cmd.expectedState,
        expectedStateMode: 'required',
        signal,
      });
      try {
        const result = await client.call(
          'split_task_item',
          {
            operation_id: meta.operationId,
            expected_state: meta.expectedState!,
            card_id: cmd.cardId,
            today_content: cmd.todayContent,
            rest_content: cmd.restContent,
            ...(cmd.restMinutes !== undefined ? { rest_minutes: cmd.restMinutes } : {}),
          },
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'split_task_item', operationId: result.operation_id, result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'split_task_item', operationId: meta.operationId });
      }
    }

    case 'get_task_details': {
      try {
        const result = await client.call('get_task_details', { task_id: cmd.taskId }, { signal });
        return { kind: 'ok', json: cmd.json, method: 'get_task_details', result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'get_task_details' });
      }
    }

    case 'complete_task': {
      const meta = await resolveWriteMeta(client, {
        method: 'complete_task',
        operationId: cmd.operationId,
        expectedState: cmd.expectedState,
        expectedStateMode: 'optional',
        signal,
      });
      try {
        const result = await client.call(
          'complete_task',
          {
            operation_id: meta.operationId,
            ...(meta.expectedState !== undefined ? { expected_state: meta.expectedState } : {}),
            task_id: cmd.taskId,
          },
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'complete_task', operationId: result.operation_id, result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'complete_task', operationId: meta.operationId });
      }
    }

    case 'reopen_task': {
      const meta = await resolveWriteMeta(client, {
        method: 'reopen_task',
        operationId: cmd.operationId,
        expectedState: cmd.expectedState,
        expectedStateMode: 'optional',
        signal,
      });
      try {
        const result = await client.call(
          'reopen_task',
          {
            operation_id: meta.operationId,
            ...(meta.expectedState !== undefined ? { expected_state: meta.expectedState } : {}),
            task_id: cmd.taskId,
            completion_id: cmd.completionId,
            ...(cmd.makeRoom !== undefined ? { make_room: cmd.makeRoom } : {}),
          },
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'reopen_task', operationId: result.operation_id, result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'reopen_task', operationId: meta.operationId });
      }
    }

    case 'get_recap': {
      try {
        const result = await client.call(
          'get_recap',
          {
            ...(cmd.period !== undefined ? { period: cmd.period } : {}),
            ...(cmd.from !== undefined ? { from: cmd.from } : {}),
            ...(cmd.to !== undefined ? { to: cmd.to } : {}),
            ...(cmd.dimension !== undefined ? { dimension: cmd.dimension } : {}),
            ...(cmd.includeIdle !== undefined ? { include_idle: cmd.includeIdle } : {}),
            ...(cmd.bucket !== undefined ? { bucket: cmd.bucket } : {}),
          },
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'get_recap', result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'get_recap' });
      }
    }

    case 'list_operation_history': {
      try {
        const result = await client.call(
          'list_operation_history',
          {
            ...(cmd.fromDay !== undefined ? { from_day: cmd.fromDay } : {}),
            ...(cmd.toDay !== undefined ? { to_day: cmd.toDay } : {}),
            ...(cmd.source !== undefined ? { source: cmd.source } : {}),
            ...(cmd.filterAgent !== undefined ? { agent: cmd.filterAgent } : {}),
            ...(cmd.filterMethod !== undefined ? { method: cmd.filterMethod } : {}),
            ...(cmd.subjectType !== undefined ? { subject_type: cmd.subjectType } : {}),
            ...(cmd.subjectId !== undefined ? { subject_id: cmd.subjectId } : {}),
            ...(cmd.operationId !== undefined ? { operation_id: cmd.operationId } : {}),
          },
          { signal },
        );
        return { kind: 'ok', json: cmd.json, method: 'list_operation_history', result };
      } catch (error) {
        throw new CliExecutionError(error, { method: 'list_operation_history' });
      }
    }
  }
}
