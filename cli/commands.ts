import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { operationId } from '../src/shared/operation.ts';
import type { ApplicationMethod } from '../src/shared/application.ts';
import { ApplicationError, type ApplicationFailure } from '../src/shared/appError.ts';
import { AGENT_RULES_NEXT_STEP } from '../src/shared/agentRules.ts';

export class CliUsageError extends ApplicationError {
  constructor(message: string, nextStep = `运行 monorail --help 查看命令格式与参数说明；${AGENT_RULES_NEXT_STEP}`) {
    const failure: ApplicationFailure = {
      status: 'error',
      code: 'USAGE_ERROR',
      category: 'not_executed',
      message,
      next_step: nextStep,
    };
    super(failure);
    this.name = 'CliUsageError';
  }
}

export type ContextSection = 'timer' | 'pending_actions' | 'options';
export type FindKind = 'idea' | 'todo_card' | 'task' | 'all';
export type DayMode = 'activity' | 'calendar';

/** 每种命令都可以带全局 `--agent <名字>`（操作历史里的调用方）。 */
export type ParsedCliCommand = ParsedCommandBody & { agent?: string };
type ParsedCommandBody =
  | { kind: 'help'; json: boolean; topic?: string }
  | { kind: 'version'; json: boolean }
  | {
      kind: 'call';
      json: boolean;
      method: 'get_context';
      sections?: ContextSection[];
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'get_operation_result';
      operationId: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'find_items';
      itemKind?: FindKind;
      query?: string;
      includeArchived?: boolean;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'get_time_summary';
      day?: string;
      dayMode?: DayMode;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'list_time_entries';
      from: string;
      to: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'save_idea';
      text: string;
      needs?: string;
      operationId?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'complete_idea';
      ideaId: string;
      operationId?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'capture_todo';
      text: string;
      taskId?: string;
      dueAt?: string;
      blocking?: boolean;
      operationId?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'add_time_entry';
      description: string;
      start: string;
      end: string;
      project?: string;
      tags?: string[];
      operationId?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'update_time_entry';
      entryId: string;
      start?: string;
      end?: string;
      description?: string;
      project?: string;
      tags?: string[];
      operationId?: string;
      expectedState?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'start_timer';
      description: string;
      project?: string;
      tags?: string[];
      operationId?: string;
      expectedState?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'start_task_item';
      cardId: string;
      operationId?: string;
      expectedState?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'pause_timer' | 'resume_timer' | 'stop_timer' | 'return_from_break';
      operationId?: string;
      expectedState?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'start_break';
      activity: string;
      operationId?: string;
      expectedState?: string;
    };

export interface ParseOptions {
  readStdin?: () => Promise<string>;
  readTextFile?: (path: string) => string;
}

const isoSchema = z.iso.datetime({ offset: true });
const sectionSchema = z.enum(['timer', 'pending_actions', 'options']);
const findKindSchema = z.enum(['idea', 'todo_card', 'task', 'all']);
const dayModeSchema = z.enum(['activity', 'calendar']);

interface FlagSpec {
  booleanFlags: ReadonlySet<string>;
  singleFlags: ReadonlySet<string>;
  multiFlags: ReadonlySet<string>;
}

interface RawFlags {
  booleans: Set<string>;
  singles: Map<string, string>;
  multis: Map<string, string[]>;
  positionals: string[];
}

function parseTokens(tokens: string[], spec: FlagSpec): RawFlags {
  const booleans = new Set<string>();
  const singles = new Map<string, string>();
  const multis = new Map<string, string[]>();
  const positionals: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--') {
      positionals.push(...tokens.slice(i + 1));
      break;
    }
    if (token === '-h') {
      booleans.add('--help');
      continue;
    }
    if (token === '-v') {
      booleans.add('--version');
      continue;
    }
    if (!token.startsWith('-') || token === '-') {
      positionals.push(token);
      continue;
    }

    const eqIdx = token.indexOf('=');
    const flagName = eqIdx >= 0 ? token.slice(0, eqIdx) : token;
    const inlineValue = eqIdx >= 0 ? token.slice(eqIdx + 1) : undefined;

    if (spec.booleanFlags.has(flagName)) {
      if (inlineValue !== undefined) {
        throw new CliUsageError(
          `USAGE_ERROR：布尔参数 ${flagName} 不接受值（收到 ${token}）；请直接传 ${flagName} 或省略该参数`,
        );
      }
      if (booleans.has(flagName)) {
        throw new CliUsageError(`USAGE_ERROR：重复参数 ${flagName}`);
      }
      booleans.add(flagName);
      continue;
    }

    if (spec.singleFlags.has(flagName)) {
      if (singles.has(flagName)) {
        throw new CliUsageError(`USAGE_ERROR：单值参数 ${flagName} 不能重复指定`);
      }
      let val: string;
      if (inlineValue !== undefined) {
        val = inlineValue;
      } else {
        if (i + 1 >= tokens.length) {
          throw new CliUsageError(`USAGE_ERROR：参数 ${flagName} 缺少对应的值`);
        }
        val = tokens[++i];
      }
      singles.set(flagName, val);
      continue;
    }

    if (spec.multiFlags.has(flagName)) {
      let val: string;
      if (inlineValue !== undefined) {
        val = inlineValue;
      } else {
        if (i + 1 >= tokens.length) {
          throw new CliUsageError(`USAGE_ERROR：参数 ${flagName} 缺少对应的值`);
        }
        val = tokens[++i];
      }
      const list = multis.get(flagName) ?? [];
      list.push(val);
      multis.set(flagName, list);
      continue;
    }

    throw new CliUsageError(`USAGE_ERROR：未知选项 ${flagName}`);
  }

  return { booleans, singles, multis, positionals };
}

function defaultReadTextFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new CliUsageError(
      `USAGE_ERROR：无法读取文件 "${filePath}"：${msg}`,
      '请检查 --text-file 路径是否存在且具有读取权限（UTF-8 编码）',
    );
  }
}

async function defaultReadStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function resolveTextInput(
  raw: RawFlags,
  fieldLabel: string,
  options: ParseOptions,
): Promise<string> {
  if (raw.positionals.length > 1) {
    throw new CliUsageError(
      `USAGE_ERROR：${fieldLabel}最多只能提供一个位置参数（收到 ${raw.positionals.length} 个）；若包含空格或多行内容请加引号或使用 --text-file / --stdin`,
    );
  }
  const hasPositional = raw.positionals.length === 1;
  const textFile = raw.singles.get('--text-file');
  const hasFile = textFile !== undefined;
  const hasStdin = raw.booleans.has('--stdin');

  const sourceCount = (hasPositional ? 1 : 0) + (hasFile ? 1 : 0) + (hasStdin ? 1 : 0);
  if (sourceCount === 0) {
    throw new CliUsageError(
      `USAGE_ERROR：缺少${fieldLabel}；请提供位置参数、--text-file <path> 或 --stdin 三者之一`,
    );
  }
  if (sourceCount > 1) {
    throw new CliUsageError(
      `USAGE_ERROR：${fieldLabel}输入来源互斥；位置参数、--text-file 与 --stdin 只能三选一`,
    );
  }

  let content: string;
  if (hasPositional) {
    content = raw.positionals[0];
  } else if (hasFile) {
    if (textFile.trim().length === 0) {
      throw new CliUsageError('USAGE_ERROR：--text-file 路径不能为空');
    }
    const reader = options.readTextFile ?? defaultReadTextFile;
    try {
      content = reader(textFile);
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      throw new CliUsageError(
        `USAGE_ERROR：无法读取文件 "${textFile}"：${msg}`,
        '请检查 --text-file 路径是否存在且具有读取权限（UTF-8 编码）',
      );
    }
  } else {
    const stdinReader = options.readStdin ?? defaultReadStdin;
    try {
      content = await stdinReader();
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      throw new CliUsageError(`USAGE_ERROR：无法读取标准输入：${msg}`);
    }
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new CliUsageError(`USAGE_ERROR：${fieldLabel}不能为空白`);
  }
  return trimmed;
}

function validateOperationId(rawId: string | undefined): string | undefined {
  if (rawId === undefined) return undefined;
  const parsed = operationId.safeParse(rawId);
  if (!parsed.success) {
    throw new CliUsageError(
      `USAGE_ERROR：--operation-id 必须是合法的 UUID（收到 "${rawId}"）`,
      '请先运行 monorail context 获取合法的 operation_id，或传入已有回执的 UUID',
    );
  }
  return parsed.data;
}

function validateExpectedState(rawState: string | undefined): string | undefined {
  if (rawState === undefined) return undefined;
  const trimmed = rawState.trim();
  if (trimmed.length === 0) {
    throw new CliUsageError('USAGE_ERROR：--expected-state 不能为空字符串');
  }
  return trimmed;
}

function validateIso(value: string, flagName: string): string {
  const parsed = isoSchema.safeParse(value);
  if (!parsed.success) {
    throw new CliUsageError(
      `USAGE_ERROR：${flagName} 必须是带时区偏移的 ISO-8601 时间字符串（如 2026-11-03T09:30:00+08:00，收到 "${value}"）`,
    );
  }
  return parsed.data;
}

interface GlobalFlags { json: boolean; help: boolean; version: boolean; agent?: string; rest: string[] }

function extractGlobalJsonAndHelp(argv: string[]): GlobalFlags {
  let json = false;
  let help = false;
  let version = false;
  let agent: string | undefined;
  const rest: string[] = [];
  let afterDoubleDash = false;

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (afterDoubleDash) {
      rest.push(token);
      continue;
    }
    if (token === '--') {
      afterDoubleDash = true;
      rest.push(token);
      continue;
    }
    // 全局 --agent <名字>：操作历史里的调用方（ADR 0019 第 6 条），任何命令都可以带
    if (token === '--agent' || token.startsWith('--agent=')) {
      if (agent !== undefined) throw new CliUsageError('USAGE_ERROR：重复参数 --agent');
      const value = token === '--agent' ? argv[++index] : token.slice('--agent='.length);
      if (value === undefined || value === '--' || !value.trim()) throw new CliUsageError('USAGE_ERROR：--agent 需要一个名字');
      agent = value.trim();
      continue;
    }
    if (token === '--json') {
      if (json) throw new CliUsageError('USAGE_ERROR：重复参数 --json');
      json = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      help = true;
      continue;
    }
    if (token === '--version' || token === '-v') {
      version = true;
      continue;
    }
    if (token.startsWith('--json=') || token.startsWith('--help=') || token.startsWith('--version=')) {
      const flagName = token.slice(0, token.indexOf('='));
      throw new CliUsageError(`USAGE_ERROR：布尔参数 ${flagName} 不接受值（收到 ${token}）`);
    }
    rest.push(token);
  }

  return { json, help, version, ...(agent !== undefined ? { agent } : {}), rest };
}

export async function parseCliArgs(argv: string[], options: ParseOptions = {}): Promise<ParsedCliCommand> {
  const globals = extractGlobalJsonAndHelp(argv);
  const parsed = await parseCommand(globals, options);
  return globals.agent !== undefined ? { ...parsed, agent: globals.agent } : parsed;
}

async function parseCommand({ json, help, version, rest }: GlobalFlags, options: ParseOptions): Promise<ParsedCliCommand> {

  if (help) {
    const topic = rest.filter(t => !t.startsWith('-')).slice(0, 2).join(' ') || undefined;
    return { kind: 'help', json, topic };
  }
  if (version) {
    if (rest.length > 0) {
      throw new CliUsageError('USAGE_ERROR：--version 不能与其他子命令或参数同时使用');
    }
    return { kind: 'version', json };
  }
  if (rest.length === 0) {
    return { kind: 'help', json };
  }

  const [cmd, ...subTokens] = rest;

  if (cmd === 'help') {
    const topic = subTokens.filter(t => !t.startsWith('-')).slice(0, 2).join(' ') || undefined;
    return { kind: 'help', json, topic };
  }
  if (cmd === 'version') {
    if (subTokens.length > 0) {
      throw new CliUsageError('USAGE_ERROR：version 命令不接受额外参数');
    }
    return { kind: 'version', json };
  }

  if (cmd === 'context') {
    const raw = parseTokens(subTokens, {
      booleanFlags: new Set(),
      singleFlags: new Set(),
      multiFlags: new Set(['--section']),
    });
    if (raw.positionals.length > 0) {
      throw new CliUsageError(`USAGE_ERROR：context 命令不接受位置参数（收到 "${raw.positionals[0]}"）`);
    }
    const rawSections = raw.multis.get('--section');
    let sections: ContextSection[] | undefined;
    if (rawSections && rawSections.length > 0) {
      sections = rawSections.map(s => {
        const parsed = sectionSchema.safeParse(s);
        if (!parsed.success) {
          throw new CliUsageError(
            `USAGE_ERROR：--section 仅支持 timer、pending_actions 或 options（收到 "${s}"）`,
          );
        }
        return parsed.data;
      });
    }
    return { kind: 'call', json, method: 'get_context', sections };
  }

  if (cmd === 'find') {
    const raw = parseTokens(subTokens, {
      booleanFlags: new Set(['--include-archived']),
      singleFlags: new Set(['--kind']),
      multiFlags: new Set(),
    });
    if (raw.positionals.length > 1) {
      throw new CliUsageError(
        `USAGE_ERROR：find 命令最多接受 1 个查询词位置参数（收到 ${raw.positionals.length} 个）`,
      );
    }
    const rawKind = raw.singles.get('--kind');
    let itemKind: FindKind | undefined;
    if (rawKind !== undefined) {
      const parsed = findKindSchema.safeParse(rawKind);
      if (!parsed.success) {
        throw new CliUsageError(
          `USAGE_ERROR：--kind 仅支持 idea、todo_card、task 或 all（收到 "${rawKind}"）`,
        );
      }
      itemKind = parsed.data;
    }
    return {
      kind: 'call',
      json,
      method: 'find_items',
      itemKind,
      query: raw.positionals[0],
      includeArchived: raw.booleans.has('--include-archived') ? true : undefined,
    };
  }

  if (cmd === 'idea') {
    const [sub, ...args] = subTokens;
    if (sub === 'done') {
      // 0.3.0-beta.4 D2（ADR 0020）：把想法池里的一个想法标记为已完成
      const raw = parseTokens(args, { booleanFlags: new Set(), singleFlags: new Set(['--operation-id']), multiFlags: new Set() });
      if (raw.positionals.length !== 1) {
        throw new CliUsageError(`USAGE_ERROR：idea done 需要且只接受 1 个想法 ID（收到 ${raw.positionals.length} 个）；先用 monorail find --kind idea 查到 ID`);
      }
      const ideaId = z.uuid().safeParse(raw.positionals[0]);
      if (!ideaId.success) throw new CliUsageError(`USAGE_ERROR：想法 ID 必须是 UUID（收到 "${raw.positionals[0]}"）`);
      return { kind: 'call', json, method: 'complete_idea', ideaId: ideaId.data, operationId: validateOperationId(raw.singles.get('--operation-id')) };
    }
    if (sub !== 'add') {
      throw new CliUsageError(
        `USAGE_ERROR：未知子命令 "idea ${sub ?? ''}".trim()；请使用 monorail idea add <text> 或 monorail idea done <idea_id>`,
      );
    }
    const raw = parseTokens(args, {
      booleanFlags: new Set(['--stdin']),
      singleFlags: new Set(['--text-file', '--needs', '--operation-id']),
      multiFlags: new Set(),
    });
    const text = await resolveTextInput(raw, '想法正文', options);
    const operationIdVal = validateOperationId(raw.singles.get('--operation-id'));
    const needs = raw.singles.get('--needs');
    return {
      kind: 'call',
      json,
      method: 'save_idea',
      text,
      needs,
      operationId: operationIdVal,
    };
  }

  if (cmd === 'todo') {
    const [sub, ...args] = subTokens;
    if (sub !== 'add') {
      throw new CliUsageError(
        `USAGE_ERROR：未知子命令 "todo ${sub ?? ''}".trim()；请使用 monorail todo add <text>`,
      );
    }
    const raw = parseTokens(args, {
      booleanFlags: new Set(['--stdin', '--blocking']),
      singleFlags: new Set(['--text-file', '--task-id', '--due-at', '--operation-id']),
      multiFlags: new Set(),
    });
    const text = await resolveTextInput(raw, '待办事项内容', options);
    const operationIdVal = validateOperationId(raw.singles.get('--operation-id'));
    const taskId = raw.singles.get('--task-id');
    if (taskId !== undefined && taskId.trim().length === 0) {
      throw new CliUsageError('USAGE_ERROR：--task-id 不能为空字符串');
    }
    const rawDue = raw.singles.get('--due-at');
    const dueAt = rawDue !== undefined ? validateIso(rawDue, '--due-at') : undefined;
    return {
      kind: 'call',
      json,
      method: 'capture_todo',
      text,
      taskId: taskId?.trim(),
      dueAt,
      blocking: raw.booleans.has('--blocking') ? true : undefined,
      operationId: operationIdVal,
    };
  }

  if (cmd === 'time') {
    const [sub, ...args] = subTokens;
    if (sub === 'summary') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(['--day', '--day-mode']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length > 0) {
        throw new CliUsageError(`USAGE_ERROR：time summary 不接受位置参数（收到 "${raw.positionals[0]}"）`);
      }
      const day = raw.singles.get('--day');
      if (day !== undefined && day.trim().length === 0) {
        throw new CliUsageError('USAGE_ERROR：--day 不能为空字符串');
      }
      const rawDayMode = raw.singles.get('--day-mode');
      let dayMode: DayMode | undefined;
      if (rawDayMode !== undefined) {
        const parsed = dayModeSchema.safeParse(rawDayMode);
        if (!parsed.success) {
          throw new CliUsageError(
            `USAGE_ERROR：--day-mode 仅支持 activity 或 calendar（收到 "${rawDayMode}"）`,
          );
        }
        dayMode = parsed.data;
      }
      return {
        kind: 'call',
        json,
        method: 'get_time_summary',
        day: day?.trim(),
        dayMode,
      };
    }

    if (sub === 'entries') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(['--from', '--to']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length > 0) {
        throw new CliUsageError(`USAGE_ERROR：time entries 不接受位置参数（收到 "${raw.positionals[0]}"）`);
      }
      const rawFrom = raw.singles.get('--from');
      const rawTo = raw.singles.get('--to');
      if (rawFrom === undefined || rawTo === undefined) {
        throw new CliUsageError('USAGE_ERROR：time entries 必须同时提供 --from <iso> 与 --to <iso>');
      }
      return {
        kind: 'call',
        json,
        method: 'list_time_entries',
        from: validateIso(rawFrom, '--from'),
        to: validateIso(rawTo, '--to'),
      };
    }

    if (sub === 'add') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(['--stdin']),
        singleFlags: new Set(['--text-file', '--start', '--end', '--project', '--operation-id']),
        multiFlags: new Set(['--tag']),
      });
      const description = await resolveTextInput(raw, '补录活动描述', options);
      const rawStart = raw.singles.get('--start');
      const rawEnd = raw.singles.get('--end');
      if (rawStart === undefined || rawEnd === undefined) {
        throw new CliUsageError('USAGE_ERROR：time add 必须同时提供 --start <iso> 与 --end <iso>');
      }
      const start = validateIso(rawStart, '--start');
      const end = validateIso(rawEnd, '--end');
      const operationIdVal = validateOperationId(raw.singles.get('--operation-id'));
      const project = raw.singles.get('--project');
      const tags = raw.multis.get('--tag');
      return {
        kind: 'call',
        json,
        method: 'add_time_entry',
        description,
        start,
        end,
        project,
        tags,
        operationId: operationIdVal,
      };
    }

    throw new CliUsageError(
      `USAGE_ERROR：未知子命令 "time ${sub ?? ''}".trim()；支持 time summary、time entries、time add`,
    );
  }

  if (cmd === 'timer') {
    const [sub, ...args] = subTokens;
    if (sub === 'start') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(['--stdin']),
        singleFlags: new Set(['--text-file', '--project', '--operation-id', '--expected-state']),
        multiFlags: new Set(['--tag']),
      });
      const description = await resolveTextInput(raw, '活动描述', options);
      const operationIdVal = validateOperationId(raw.singles.get('--operation-id'));
      const expectedState = validateExpectedState(raw.singles.get('--expected-state'));
      const project = raw.singles.get('--project');
      const tags = raw.multis.get('--tag');
      return {
        kind: 'call',
        json,
        method: 'start_timer',
        description,
        project,
        tags,
        operationId: operationIdVal,
        expectedState,
      };
    }

    if (sub === 'start-item') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(['--operation-id', '--expected-state']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length !== 1 || raw.positionals[0].trim().length === 0) {
        throw new CliUsageError(
          'USAGE_ERROR：timer start-item 必须提供精确的待办事项卡片 ID（如 monorail timer start-item <card-id>）',
        );
      }
      const operationIdVal = validateOperationId(raw.singles.get('--operation-id'));
      const expectedState = validateExpectedState(raw.singles.get('--expected-state'));
      return {
        kind: 'call',
        json,
        method: 'start_task_item',
        cardId: raw.positionals[0].trim(),
        operationId: operationIdVal,
        expectedState,
      };
    }

    if (sub === 'pause' || sub === 'resume' || sub === 'stop') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(['--operation-id', '--expected-state']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length > 0) {
        throw new CliUsageError(`USAGE_ERROR：timer ${sub} 不接受位置参数（收到 "${raw.positionals[0]}"）`);
      }
      const operationIdVal = validateOperationId(raw.singles.get('--operation-id'));
      const expectedState = validateExpectedState(raw.singles.get('--expected-state'));
      const methodMap = {
        pause: 'pause_timer',
        resume: 'resume_timer',
        stop: 'stop_timer',
      } as const;
      return {
        kind: 'call',
        json,
        method: methodMap[sub],
        operationId: operationIdVal,
        expectedState,
      };
    }

    throw new CliUsageError(
      `USAGE_ERROR：未知子命令 "timer ${sub ?? ''}".trim()；支持 timer start、timer start-item、timer pause、timer resume、timer stop`,
    );
  }

  if (cmd === 'break') {
    const [sub, ...args] = subTokens;
    if (sub === 'start') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(['--stdin']),
        singleFlags: new Set(['--text-file', '--operation-id', '--expected-state']),
        multiFlags: new Set(),
      });
      const activity = await resolveTextInput(raw, '临时离开活动名称', options);
      const operationIdVal = validateOperationId(raw.singles.get('--operation-id'));
      const expectedState = validateExpectedState(raw.singles.get('--expected-state'));
      return {
        kind: 'call',
        json,
        method: 'start_break',
        activity,
        operationId: operationIdVal,
        expectedState,
      };
    }

    if (sub === 'return') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(['--operation-id', '--expected-state']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length > 0) {
        throw new CliUsageError(`USAGE_ERROR：break return 不接受位置参数（收到 "${raw.positionals[0]}"）`);
      }
      const operationIdVal = validateOperationId(raw.singles.get('--operation-id'));
      const expectedState = validateExpectedState(raw.singles.get('--expected-state'));
      return {
        kind: 'call',
        json,
        method: 'return_from_break',
        operationId: operationIdVal,
        expectedState,
      };
    }

    throw new CliUsageError(
      `USAGE_ERROR：未知子命令 "break ${sub ?? ''}".trim()；支持 break start <activity>、break return`,
    );
  }

  if (cmd === 'entry') {
    const [sub, ...args] = subTokens;
    if (sub !== 'edit') {
      throw new CliUsageError(`USAGE_ERROR：未知子命令 "entry ${sub ?? ''}".trim()；支持 entry edit <entry-id>`);
    }
    const raw = parseTokens(args, {
      booleanFlags: new Set(['--clear-tags']),
      singleFlags: new Set(['--start', '--end', '--description', '--project', '--operation-id', '--expected-state']),
      multiFlags: new Set(['--tag']),
    });
    if (raw.positionals.length !== 1 || raw.positionals[0].trim().length === 0) {
      throw new CliUsageError('USAGE_ERROR：entry edit 必须提供 1 个计时记录 ID（来自 monorail time entries）');
    }
    const rawStart = raw.singles.get('--start'), rawEnd = raw.singles.get('--end');
    const tagList = raw.multis.get('--tag');
    if (raw.booleans.has('--clear-tags') && tagList !== undefined) {
      throw new CliUsageError('USAGE_ERROR：--clear-tags 不能和 --tag 一起用');
    }
    const tags = raw.booleans.has('--clear-tags') ? [] : tagList;
    const description = raw.singles.get('--description'), project = raw.singles.get('--project');
    if (rawStart === undefined && rawEnd === undefined && description === undefined && project === undefined && tags === undefined) {
      throw new CliUsageError('USAGE_ERROR：entry edit 至少要改一项：--start、--end、--description、--project、--tag 或 --clear-tags');
    }
    return {
      kind: 'call',
      json,
      method: 'update_time_entry',
      entryId: raw.positionals[0].trim(),
      start: rawStart === undefined ? undefined : validateIso(rawStart, '--start'),
      end: rawEnd === undefined ? undefined : validateIso(rawEnd, '--end'),
      description,
      project,
      tags,
      operationId: validateOperationId(raw.singles.get('--operation-id')),
      expectedState: validateExpectedState(raw.singles.get('--expected-state')),
    };
  }

  if (cmd === 'operation') {
    const [sub, ...args] = subTokens;
    if (sub !== 'get') {
      throw new CliUsageError(
        `USAGE_ERROR：未知子命令 "operation ${sub ?? ''}".trim()；请使用 monorail operation get <operation-id>`,
      );
    }
    const raw = parseTokens(args, {
      booleanFlags: new Set(),
      singleFlags: new Set(),
      multiFlags: new Set(),
    });
    if (raw.positionals.length !== 1) {
      throw new CliUsageError('USAGE_ERROR：operation get 必须提供 1 个操作 ID（UUID）');
    }
    const opId = validateOperationId(raw.positionals[0]);
    return {
      kind: 'call',
      json,
      method: 'get_operation_result',
      operationId: opId!,
    };
  }

  throw new CliUsageError(
    `USAGE_ERROR：未知命令 "${cmd}"；CLI 没有这个命令，运行 monorail --help 查看全部支持的命令`,
    `CLI 没有这个命令。${AGENT_RULES_NEXT_STEP}`,
  );
}

export function inferMethodFromCommand(cmd: ParsedCliCommand): ApplicationMethod | undefined {
  return cmd.kind === 'call' ? cmd.method : undefined;
}
