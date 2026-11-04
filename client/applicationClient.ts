import {
  applicationContracts,
} from '../src/shared/application.ts';
import type {
  ApplicationInput,
  ApplicationMethod,
  ApplicationOutput,
  ApplicationRequest,
  CallerOrigin,
} from '../src/shared/application.ts';
import { ApplicationError, applicationFailure } from '../src/shared/appError.ts';
import { callDesktop, defaultPipePath } from './pipe.ts';
import type { DesktopCallOptions } from './pipe.ts';

/** Raw wire transport boundary; unknown is confined here and never leaked to callers. */
export interface ApplicationTransport {
  send(request: ApplicationRequest, options?: { signal?: AbortSignal }): Promise<unknown>;
}

/**
 * Per-call options. `origin` identifies the calling agent for the operation history (ADR 0019 §6);
 * it travels as a top-level request field, never inside `arguments`, so it cannot affect input
 * validation or receipt conflict checks.
 */
export interface ApplicationCallOptions {
  signal?: AbortSignal;
  origin?: CallerOrigin;
}

/** Typed, transport-independent application client shared by MCP and CLI adapters. */
export interface ApplicationClient {
  call<M extends ApplicationMethod>(
    method: M,
    input: ApplicationInput<M>,
    options?: ApplicationCallOptions,
  ): Promise<ApplicationOutput<M>>;
}

/** `defaults.origin` applies when a call does not pass its own (the CLI knows its origin once per process). */
export function createApplicationClient(
  transport: ApplicationTransport,
  defaults: { origin?: CallerOrigin } = {},
): ApplicationClient {
  return {
    async call<M extends ApplicationMethod>(
      method: M,
      input: ApplicationInput<M>,
      options?: ApplicationCallOptions,
    ): Promise<ApplicationOutput<M>> {
      const contract = applicationContracts[method];
      if (!contract) {
        throw new ApplicationError({
          status: 'error',
          code: 'UNKNOWN_METHOD',
          category: 'not_executed',
          message: `UNKNOWN_METHOD：未知单轨应用方法：${String(method)}`,
          next_step: '请使用受支持的单轨命令或工具',
        });
      }
      const parsedInput = contract.input.safeParse(input);
      if (!parsedInput.success) {
        throw new ApplicationError({
          status: 'error',
          code: 'INVALID_INPUT',
          category: 'not_executed',
          message: `INVALID_INPUT：输入参数不符合契约：${parsedInput.error.message}`,
          next_step: '请根据参数说明修正输入后重试',
        }, parsedInput.error);
      }
      const origin = options?.origin ?? defaults.origin;
      let raw: unknown;
      try {
        raw = await transport.send(
          { method, arguments: parsedInput.data, ...(origin ? { origin } : {}) } as ApplicationRequest,
          { signal: options?.signal },
        );
      } catch (error) {
        if (error instanceof ApplicationError) throw error;
        throw new ApplicationError(applicationFailure(error), error);
      }
      const parsedOutput = contract.output.safeParse(raw);
      if (!parsedOutput.success) {
        throw new ApplicationError({
          status: 'error',
          code: 'INVALID_RESPONSE',
          category: 'result_unknown',
          message: `单轨返回结果不符合契约：${parsedOutput.error.message}`,
          next_step: '不要重复写入；若这是写操作，请使用原 operation_id 核对 get_operation_result',
        }, parsedOutput.error);
      }
      return parsedOutput.data as ApplicationOutput<M>;
    },
  };
}

export function createPipeApplicationClient(
  pipe = defaultPipePath(),
  defaults: Omit<DesktopCallOptions, 'signal'> = {},
  options: { origin?: CallerOrigin } = {},
): ApplicationClient {
  return createApplicationClient({
    send: (request, sendOptions) => callDesktop(pipe, request, { ...defaults, signal: sendOptions?.signal }),
  }, options);
}
