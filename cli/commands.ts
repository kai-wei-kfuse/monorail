import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { operationId } from '../src/shared/operation.ts';
import { taskItemInputSchema, type ApplicationMethod, type TaskItemInput } from '../src/shared/application.ts';
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
export type PlanShowDay = 'today' | 'tomorrow';
export type PlanPriority = '普通' | '高';
export type RecapPeriodOption = 'week' | 'lastWeek' | 'cycle' | 'month' | 'quarter' | 'year' | 'custom';
export type RecapDimensionOption = 'project' | 'tag' | 'source' | 'activity';
export type HistorySourceOption = 'manual' | 'system' | 'mcp' | 'cli' | 'automation' | 'all_automation';
export type HistorySubjectTypeOption = 'entry' | 'card' | 'task' | 'record' | 'review' | 'settings' | 'state';
export type MakeRoomOption = { action: 'freeze' | 'abandon'; task_id: string };

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
      method: 'create_idea';
      title: string;
      detailsMarkdown?: string;
      needs?: string;
      operationId?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'get_idea_details';
      ideaId: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'update_idea';
      ideaId: string;
      recordRevision?: string;
      title?: string;
      detailsMarkdown?: string;
      needs?: string | null;
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
      method: 'reopen_idea';
      ideaId: string;
      operationId?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'convert_idea_to_task';
      ideaId: string;
      recordRevision?: string;
      target:
        | { kind: 'existing_task'; task_id: string }
        | { kind: 'new_task'; name: string; slot: '主线' | '支线'; default_project?: string };
      items: TaskItemInput[];
      operationId?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'create_task';
      name: string;
      slot: '主线' | '支线';
      defaultProject?: string;
      items?: TaskItemInput[];
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
      method: 'pause_timer' | 'resume_timer' | 'stop_timer' | 'return_from_break' | 'end_original_task';
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
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'get_task_plan';
      day?: PlanShowDay;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'add_plan_item';
      cardId: string;
      day: string;
      priority?: PlanPriority;
      todayMinutes?: number;
      operationId?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'remove_plan_item';
      cardId: string;
      day: string;
      operationId?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'update_plan_item';
      cardId: string;
      day: string;
      priority?: PlanPriority;
      todayMinutes?: number;
      operationId?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'confirm_plan_carry';
      day: string;
      keepCardIds: string[];
      operationId?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'skip_today_plan';
      day: string;
      operationId?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'draw_task_item';
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'skip_task_item';
      cardId: string;
      day: string;
      operationId?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'complete_task_item';
      cardId: string;
      note?: string;
      finishEarly?: boolean;
      operationId?: string;
      expectedState?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'reopen_task_item';
      cardId: string;
      makeRoom?: MakeRoomOption;
      operationId?: string;
      expectedState?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'keep_going_task_item';
      cardId: string;
      note?: string;
      operationId?: string;
      expectedState?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'split_task_item';
      cardId: string;
      todayContent: string;
      restContent: string;
      restMinutes?: number;
      operationId?: string;
      expectedState?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'get_task_details';
      taskId: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'complete_task';
      taskId: string;
      operationId?: string;
      expectedState?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'reopen_task';
      taskId: string;
      completionId: string | null;
      makeRoom?: MakeRoomOption;
      operationId?: string;
      expectedState?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'get_recap';
      period?: RecapPeriodOption;
      from?: string;
      to?: string;
      dimension?: RecapDimensionOption;
      includeIdle?: boolean;
      bucket?: string;
    }
  | {
      kind: 'call';
      json: boolean;
      method: 'list_operation_history';
      fromDay?: string;
      toDay?: string;
      source?: HistorySourceOption;
      filterAgent?: string;
      filterMethod?: string;
      subjectType?: HistorySubjectTypeOption;
      subjectId?: string;
      operationId?: string;
    };

export interface ParseOptions {
  readStdin?: () => Promise<string>;
  readTextFile?: (path: string) => string;
}

const isoSchema = z.iso.datetime({ offset: true });
const isoDateSchema = z.iso.date();
const sectionSchema = z.enum(['timer', 'pending_actions', 'options']);
const findKindSchema = z.enum(['idea', 'todo_card', 'task', 'all']);
const dayModeSchema = z.enum(['activity', 'calendar']);
const planShowDaySchema = z.enum(['today', 'tomorrow']);
const planPrioritySchema = z.enum(['普通', '高']);
const recapPeriodSchema = z.enum(['week', 'lastWeek', 'cycle', 'month', 'quarter', 'year', 'custom']);
const recapDimensionSchema = z.enum(['project', 'tag', 'source', 'activity']);
const historySourceSchema = z.enum(['manual', 'system', 'mcp', 'cli', 'automation', 'all_automation']);
const historySubjectTypeSchema = z.enum(['entry', 'card', 'task', 'record', 'review', 'settings', 'state']);

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

function validateIsoDate(value: string, flagName: string): string {
  const parsed = isoDateSchema.safeParse(value);
  if (!parsed.success) {
    throw new CliUsageError(
      `USAGE_ERROR：${flagName} 必须是真实有效的活动日 YYYY-MM-DD（如 2026-11-07，收到 "${value}"）`,
    );
  }
  return parsed.data;
}

function validatePositiveInt(value: string, flagName: string): number {
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new CliUsageError(`USAGE_ERROR：${flagName} 必须是正整数（收到 "${value}"）`);
  }
  const num = Number(trimmed);
  if (!Number.isSafeInteger(num) || num <= 0) {
    throw new CliUsageError(`USAGE_ERROR：${flagName} 必须是正整数（收到 "${value}"）`);
  }
  return num;
}

async function resolveOptionalNoteInput(
  raw: RawFlags,
  options: ParseOptions,
): Promise<string | undefined> {
  const noteDirect = raw.singles.get('--note');
  const noteFile = raw.singles.get('--note-file');
  const hasStdin = raw.booleans.has('--stdin');

  const sourceCount = (noteDirect !== undefined ? 1 : 0) + (noteFile !== undefined ? 1 : 0) + (hasStdin ? 1 : 0);
  if (sourceCount === 0) return undefined;
  if (sourceCount > 1) {
    throw new CliUsageError('USAGE_ERROR：进度笔记输入来源互斥；--note、--note-file 与 --stdin 只能三选一');
  }
  if (noteDirect !== undefined) {
    return noteDirect.trim();
  }
  if (noteFile !== undefined) {
    if (noteFile.trim().length === 0) {
      throw new CliUsageError('USAGE_ERROR：--note-file 路径不能为空');
    }
    const reader = options.readTextFile ?? defaultReadTextFile;
    try {
      return reader(noteFile).trim();
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      throw new CliUsageError(`USAGE_ERROR：无法读取文件 "${noteFile}"：${msg}`);
    }
  }
  const stdinReader = options.readStdin ?? defaultReadStdin;
  try {
    return (await stdinReader()).trim();
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new CliUsageError(`USAGE_ERROR：无法读取标准输入：${msg}`);
  }
}

async function resolveOptionalDetailsInput(
  raw: RawFlags,
  options: ParseOptions,
  allowClear = false,
): Promise<string | undefined> {
  const detailsFile = raw.singles.get('--details-file');
  const hasStdin = raw.booleans.has('--details-stdin');
  const hasClear = allowClear && raw.booleans.has('--clear-details');

  const sourceCount = (detailsFile !== undefined ? 1 : 0) + (hasStdin ? 1 : 0) + (hasClear ? 1 : 0);
  if (sourceCount === 0) return undefined;
  if (sourceCount > 1) {
    throw new CliUsageError(
      allowClear
        ? 'USAGE_ERROR：详情输入来源互斥；--details-file、--details-stdin 与 --clear-details 只能三选一'
        : 'USAGE_ERROR：详情输入来源互斥；--details-file 与 --details-stdin 只能二选一',
    );
  }
  if (hasClear) {
    return '';
  }
  if (detailsFile !== undefined) {
    if (detailsFile.trim().length === 0) {
      throw new CliUsageError('USAGE_ERROR：--details-file 路径不能为空');
    }
    const reader = options.readTextFile ?? defaultReadTextFile;
    try {
      return reader(detailsFile);
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      throw new CliUsageError(`USAGE_ERROR：无法读取文件 "${detailsFile}"：${msg}`);
    }
  }
  const stdinReader = options.readStdin ?? defaultReadStdin;
  try {
    return await stdinReader();
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new CliUsageError(`USAGE_ERROR：无法读取标准输入：${msg}`);
  }
}

const taskSlotSchema = z.enum(['主线', '支线']);
const taskItemsArraySchema = z.array(taskItemInputSchema).min(1, '事项列表至少需要包含 1 项');

function parseTaskItemsJson(rawJson: string, sourceLabel: string): TaskItemInput[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawJson);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new CliUsageError(
      `USAGE_ERROR：${sourceLabel} JSON 解析失败：${msg}；请提供合法的 TaskItemInput 数组 JSON，如 [{"content":"...","type":"结果卡","timebox_minutes":null}]`,
    );
  }
  const parsed = taskItemsArraySchema.safeParse(decoded);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CliUsageError(
      `USAGE_ERROR：${sourceLabel} 事项格式无效（${issue ? `${issue.path.join('.') || 'items'}: ${issue.message}` : '不符合 TaskItemInput[] 契约'}）`,
    );
  }
  return parsed.data;
}

async function resolveTaskItemsInput(
  raw: RawFlags,
  options: ParseOptions,
  required: boolean,
): Promise<TaskItemInput[] | undefined> {
  const itemList = raw.multis.get('--item');
  const itemsFile = raw.singles.get('--items-file');
  const hasStdin = raw.booleans.has('--items-stdin');

  const sourceCount = (itemList !== undefined ? 1 : 0) + (itemsFile !== undefined ? 1 : 0) + (hasStdin ? 1 : 0);
  if (sourceCount === 0) {
    if (required) {
      throw new CliUsageError('USAGE_ERROR：必须提供至少一项任务事项（--item <content>、--items-file <path> 或 --items-stdin 三选一）');
    }
    return undefined;
  }
  if (sourceCount > 1) {
    throw new CliUsageError('USAGE_ERROR：任务事项来源互斥；--item、--items-file 与 --items-stdin 只能三选一');
  }
  if (itemList !== undefined) {
    return itemList.map((rawContent, idx) => {
      const content = rawContent.trim();
      if (!content) {
        throw new CliUsageError(`USAGE_ERROR：第 ${idx + 1} 个 --item 内容不能为空白`);
      }
      return { content, type: '结果卡' as const, timebox_minutes: null };
    });
  }
  if (itemsFile !== undefined) {
    if (itemsFile.trim().length === 0) {
      throw new CliUsageError('USAGE_ERROR：--items-file 路径不能为空');
    }
    const reader = options.readTextFile ?? defaultReadTextFile;
    let rawText: string;
    try {
      rawText = reader(itemsFile);
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      throw new CliUsageError(`USAGE_ERROR：无法读取文件 "${itemsFile}"：${msg}`);
    }
    return parseTaskItemsJson(rawText, `--items-file (${itemsFile})`);
  }
  const stdinReader = options.readStdin ?? defaultReadStdin;
  let rawStdin: string;
  try {
    rawStdin = await stdinReader();
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new CliUsageError(`USAGE_ERROR：无法读取标准输入：${msg}`);
  }
  return parseTaskItemsJson(rawStdin, '--items-stdin');
}

function parseMakeRoomOption(raw: RawFlags): MakeRoomOption | undefined {
  const combined = raw.singles.get('--make-room');
  const actionFlag = raw.singles.get('--make-room-action');
  const taskFlag = raw.singles.get('--make-room-task');

  if (combined !== undefined && (actionFlag !== undefined || taskFlag !== undefined)) {
    throw new CliUsageError('USAGE_ERROR：--make-room 不能与 --make-room-action / --make-room-task 同时使用');
  }
  if (combined !== undefined) {
    const sep = combined.indexOf(':');
    const actionRaw = sep >= 0 ? combined.slice(0, sep).trim() : '';
    const taskIdRaw = sep >= 0 ? combined.slice(sep + 1).trim() : '';
    if ((actionRaw !== 'freeze' && actionRaw !== 'abandon') || taskIdRaw.length === 0) {
      throw new CliUsageError(
        `USAGE_ERROR：--make-room 格式必须为 freeze:<task-id> 或 abandon:<task-id>（收到 "${combined}"）`,
      );
    }
    return { action: actionRaw, task_id: taskIdRaw };
  }
  if (actionFlag !== undefined || taskFlag !== undefined) {
    if (actionFlag === undefined || taskFlag === undefined) {
      throw new CliUsageError('USAGE_ERROR：--make-room-action 与 --make-room-task 必须同时提供');
    }
    const actionTrimmed = actionFlag.trim();
    const taskTrimmed = taskFlag.trim();
    if ((actionTrimmed !== 'freeze' && actionTrimmed !== 'abandon') || taskTrimmed.length === 0) {
      throw new CliUsageError('USAGE_ERROR：--make-room-action 仅支持 freeze 或 abandon，且 --make-room-task 不能为空');
    }
    return { action: actionTrimmed, task_id: taskTrimmed };
  }
  return undefined;
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
    // 全局 --agent <名字>：操作历史里的调用方（ADR 0019 第 6 条），任何命令都可以带；
    // 但若出现在 `history list` 子命令之后，则留给 `history list` 作为调用方筛选条件。
    if ((token === '--agent' || token.startsWith('--agent=')) && rest[0] !== 'history') {
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
    if (sub === 'create') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(['--details-stdin']),
        singleFlags: new Set(['--title', '--details-file', '--needs', '--operation-id']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length > 0) {
        throw new CliUsageError(
          `USAGE_ERROR：idea create 不接受位置参数（收到 "${raw.positionals[0]}"）；请使用 --title <title> 与可选 --details-file <path> / --details-stdin`,
        );
      }
      const title = raw.singles.get('--title') ?? '';
      if (title.includes('\n') || title.includes('\r')) {
        throw new CliUsageError('USAGE_ERROR：--title 必须是单行文本，不能包含换行');
      }
      const detailsMarkdown = await resolveOptionalDetailsInput(raw, options, false);
      if (title.trim().length === 0 && (detailsMarkdown ?? '').trim().length === 0) {
        throw new CliUsageError(
          'USAGE_ERROR：idea create 至少需要提供非空的 --title <title> 或通过 --details-file / --details-stdin 提供非空详情正文',
        );
      }
      const needs = raw.singles.get('--needs');
      return {
        kind: 'call',
        json,
        method: 'create_idea',
        title,
        ...(detailsMarkdown !== undefined ? { detailsMarkdown } : {}),
        ...(needs !== undefined ? { needs } : {}),
        operationId: validateOperationId(raw.singles.get('--operation-id')),
      };
    }
    if (sub === 'show') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(),
        multiFlags: new Set(),
      });
      if (raw.positionals.length !== 1) {
        throw new CliUsageError(
          `USAGE_ERROR：idea show 需要且只接受 1 个想法 ID（收到 ${raw.positionals.length} 个）；先用 monorail find --kind idea 查到 ID`,
        );
      }
      const ideaId = z.uuid().safeParse(raw.positionals[0]);
      if (!ideaId.success) {
        throw new CliUsageError(`USAGE_ERROR：想法 ID 必须是 UUID（收到 "${raw.positionals[0]}"）`);
      }
      return { kind: 'call', json, method: 'get_idea_details', ideaId: ideaId.data };
    }
    if (sub === 'edit') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(['--details-stdin', '--clear-details', '--clear-needs']),
        singleFlags: new Set(['--title', '--details-file', '--needs', '--record-revision', '--operation-id']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length !== 1) {
        throw new CliUsageError(
          `USAGE_ERROR：idea edit 需要且只接受 1 个想法 ID（收到 ${raw.positionals.length} 个）；先用 monorail find --kind idea 查到 ID`,
        );
      }
      const ideaId = z.uuid().safeParse(raw.positionals[0]);
      if (!ideaId.success) {
        throw new CliUsageError(`USAGE_ERROR：想法 ID 必须是 UUID（收到 "${raw.positionals[0]}"）`);
      }
      const title = raw.singles.get('--title');
      if (title !== undefined && (title.includes('\n') || title.includes('\r'))) {
        throw new CliUsageError('USAGE_ERROR：--title 必须是单行文本，不能包含换行');
      }
      const detailsMarkdown = await resolveOptionalDetailsInput(raw, options, true);
      const rawNeeds = raw.singles.get('--needs');
      const clearNeeds = raw.booleans.has('--clear-needs');
      if (rawNeeds !== undefined && clearNeeds) {
        throw new CliUsageError('USAGE_ERROR：--needs 不能与 --clear-needs 同时使用');
      }
      const needs: string | null | undefined = clearNeeds ? null : rawNeeds;
      if (title === undefined && detailsMarkdown === undefined && needs === undefined) {
        throw new CliUsageError(
          'USAGE_ERROR：idea edit 至少需要修改一项：--title、--details-file / --details-stdin / --clear-details、--needs 或 --clear-needs',
        );
      }
      const rawRev = raw.singles.get('--record-revision');
      if (rawRev !== undefined && rawRev.trim().length === 0) {
        throw new CliUsageError('USAGE_ERROR：--record-revision 不能为空字符串');
      }
      return {
        kind: 'call',
        json,
        method: 'update_idea',
        ideaId: ideaId.data,
        ...(rawRev !== undefined ? { recordRevision: rawRev.trim() } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(detailsMarkdown !== undefined ? { detailsMarkdown } : {}),
        ...(needs !== undefined ? { needs } : {}),
        operationId: validateOperationId(raw.singles.get('--operation-id')),
      };
    }
    if (sub === 'convert') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(['--items-stdin']),
        singleFlags: new Set([
          '--task-id',
          '--new-task-name',
          '--slot',
          '--default-project',
          '--items-file',
          '--record-revision',
          '--operation-id',
        ]),
        multiFlags: new Set(['--item']),
      });
      if (raw.positionals.length !== 1) {
        throw new CliUsageError(
          `USAGE_ERROR：idea convert 需要且只接受 1 个想法 ID（收到 ${raw.positionals.length} 个）；先用 monorail find --kind idea 查到 ID`,
        );
      }
      const ideaId = z.uuid().safeParse(raw.positionals[0]);
      if (!ideaId.success) {
        throw new CliUsageError(`USAGE_ERROR：想法 ID 必须是 UUID（收到 "${raw.positionals[0]}"）`);
      }
      const taskId = raw.singles.get('--task-id');
      const newTaskName = raw.singles.get('--new-task-name');
      const rawSlot = raw.singles.get('--slot');
      const defaultProject = raw.singles.get('--default-project');
      if (taskId !== undefined && (newTaskName !== undefined || rawSlot !== undefined || defaultProject !== undefined)) {
        throw new CliUsageError(
          'USAGE_ERROR：--task-id（放入现有任务）不能与 --new-task-name、--slot 或 --default-project（新建任务）同时使用',
        );
      }
      let target:
        | { kind: 'existing_task'; task_id: string }
        | { kind: 'new_task'; name: string; slot: '主线' | '支线'; default_project?: string };
      if (taskId !== undefined) {
        if (taskId.trim().length === 0) {
          throw new CliUsageError('USAGE_ERROR：--task-id 不能为空字符串');
        }
        target = { kind: 'existing_task', task_id: taskId.trim() };
      } else {
        if (newTaskName === undefined || rawSlot === undefined) {
          throw new CliUsageError(
            'USAGE_ERROR：idea convert 必须指定 --task-id <task-id>（放入现有任务），或同时指定 --new-task-name <name> 与 --slot 主线|支线（新建任务）',
          );
        }
        if (newTaskName.trim().length === 0) {
          throw new CliUsageError('USAGE_ERROR：--new-task-name 不能为空白');
        }
        const slotParsed = taskSlotSchema.safeParse(rawSlot);
        if (!slotParsed.success) {
          throw new CliUsageError(`USAGE_ERROR：--slot 仅支持 主线 或 支线（收到 "${rawSlot}"）`);
        }
        if (defaultProject !== undefined && defaultProject.trim().length === 0) {
          throw new CliUsageError('USAGE_ERROR：--default-project 不能为空字符串');
        }
        target = {
          kind: 'new_task',
          name: newTaskName.trim(),
          slot: slotParsed.data,
          ...(defaultProject !== undefined ? { default_project: defaultProject.trim() } : {}),
        };
      }
      const items = await resolveTaskItemsInput(raw, options, true);
      const rawRev = raw.singles.get('--record-revision');
      if (rawRev !== undefined && rawRev.trim().length === 0) {
        throw new CliUsageError('USAGE_ERROR：--record-revision 不能为空字符串');
      }
      return {
        kind: 'call',
        json,
        method: 'convert_idea_to_task',
        ideaId: ideaId.data,
        ...(rawRev !== undefined ? { recordRevision: rawRev.trim() } : {}),
        target,
        items: items!,
        operationId: validateOperationId(raw.singles.get('--operation-id')),
      };
    }
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
    if (sub === 'reopen') {
      const raw = parseTokens(args, { booleanFlags: new Set(), singleFlags: new Set(['--operation-id']), multiFlags: new Set() });
      if (raw.positionals.length !== 1) {
        throw new CliUsageError(`USAGE_ERROR：idea reopen 需要且只接受 1 个想法 ID（收到 ${raw.positionals.length} 个）；先用 monorail find --kind idea --include-archived 查到 ID`);
      }
      const ideaId = z.uuid().safeParse(raw.positionals[0]);
      if (!ideaId.success) throw new CliUsageError(`USAGE_ERROR：想法 ID 必须是 UUID（收到 "${raw.positionals[0]}"）`);
      return { kind: 'call', json, method: 'reopen_idea', ideaId: ideaId.data, operationId: validateOperationId(raw.singles.get('--operation-id')) };
    }
    if (sub !== 'add') {
      throw new CliUsageError(
        `USAGE_ERROR：未知子命令 "${`idea ${sub ?? ''}`.trim()}"；请使用 monorail idea add、idea create、idea show、idea edit、idea convert、idea done 或 idea reopen`,
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
        `USAGE_ERROR：未知子命令 "${`todo ${sub ?? ''}`.trim()}"；请使用 monorail todo add <text>`,
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
      `USAGE_ERROR：未知子命令 "${`time ${sub ?? ''}`.trim()}"；支持 time summary、time entries、time add`,
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
      `USAGE_ERROR：未知子命令 "${`timer ${sub ?? ''}`.trim()}"；支持 timer start、timer start-item、timer pause、timer resume、timer stop`,
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

    if (sub === 'return' || sub === 'end-original') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(['--operation-id', '--expected-state']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length > 0) {
        throw new CliUsageError(`USAGE_ERROR：break ${sub} 不接受位置参数（收到 "${raw.positionals[0]}"）`);
      }
      const operationIdVal = validateOperationId(raw.singles.get('--operation-id'));
      const expectedState = validateExpectedState(raw.singles.get('--expected-state'));
      return {
        kind: 'call',
        json,
        method: sub === 'return' ? 'return_from_break' : 'end_original_task',
        operationId: operationIdVal,
        expectedState,
      };
    }

    throw new CliUsageError(
      `USAGE_ERROR：未知子命令 "${`break ${sub ?? ''}`.trim()}"；支持 break start <activity>、break return、break end-original`,
    );
  }

  if (cmd === 'plan') {
    const [sub, ...args] = subTokens;
    if (sub === 'show') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(['--day']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length > 0) {
        throw new CliUsageError(`USAGE_ERROR：plan show 不接受位置参数（收到 "${raw.positionals[0]}"）`);
      }
      const rawDay = raw.singles.get('--day');
      let day: PlanShowDay | undefined;
      if (rawDay !== undefined) {
        const parsed = planShowDaySchema.safeParse(rawDay);
        if (!parsed.success) {
          throw new CliUsageError(`USAGE_ERROR：plan show --day 仅支持 today 或 tomorrow（收到 "${rawDay}"）`);
        }
        day = parsed.data;
      }
      return { kind: 'call', json, method: 'get_task_plan', day };
    }

    if (sub === 'add') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(['--day', '--priority', '--today-minutes', '--operation-id']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length !== 1 || raw.positionals[0].trim().length === 0) {
        throw new CliUsageError('USAGE_ERROR：plan add 必须提供 1 个卡片 ID（如 monorail plan add <card-id> --day <YYYY-MM-DD>）');
      }
      const rawDay = raw.singles.get('--day');
      if (rawDay === undefined) {
        throw new CliUsageError('USAGE_ERROR：plan add 必须提供 --day <YYYY-MM-DD>');
      }
      const day = validateIsoDate(rawDay, '--day');
      const rawPriority = raw.singles.get('--priority');
      let priority: PlanPriority | undefined;
      if (rawPriority !== undefined) {
        const parsed = planPrioritySchema.safeParse(rawPriority);
        if (!parsed.success) {
          throw new CliUsageError(`USAGE_ERROR：--priority 仅支持 普通 或 高（收到 "${rawPriority}"）`);
        }
        priority = parsed.data;
      }
      const rawMinutes = raw.singles.get('--today-minutes');
      const todayMinutes = rawMinutes !== undefined ? validatePositiveInt(rawMinutes, '--today-minutes') : undefined;
      return {
        kind: 'call',
        json,
        method: 'add_plan_item',
        cardId: raw.positionals[0].trim(),
        day,
        priority,
        todayMinutes,
        operationId: validateOperationId(raw.singles.get('--operation-id')),
      };
    }

    if (sub === 'remove') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(['--day', '--operation-id']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length !== 1 || raw.positionals[0].trim().length === 0) {
        throw new CliUsageError('USAGE_ERROR：plan remove 必须提供 1 个卡片 ID（如 monorail plan remove <card-id> --day <YYYY-MM-DD>）');
      }
      const rawDay = raw.singles.get('--day');
      if (rawDay === undefined) {
        throw new CliUsageError('USAGE_ERROR：plan remove 必须提供 --day <YYYY-MM-DD>');
      }
      return {
        kind: 'call',
        json,
        method: 'remove_plan_item',
        cardId: raw.positionals[0].trim(),
        day: validateIsoDate(rawDay, '--day'),
        operationId: validateOperationId(raw.singles.get('--operation-id')),
      };
    }

    if (sub === 'edit') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(['--day', '--priority', '--today-minutes', '--operation-id']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length !== 1 || raw.positionals[0].trim().length === 0) {
        throw new CliUsageError('USAGE_ERROR：plan edit 必须提供 1 个卡片 ID（如 monorail plan edit <card-id> --day <YYYY-MM-DD> ...）');
      }
      const rawDay = raw.singles.get('--day');
      if (rawDay === undefined) {
        throw new CliUsageError('USAGE_ERROR：plan edit 必须提供 --day <YYYY-MM-DD>');
      }
      const day = validateIsoDate(rawDay, '--day');
      const rawPriority = raw.singles.get('--priority');
      let priority: PlanPriority | undefined;
      if (rawPriority !== undefined) {
        const parsed = planPrioritySchema.safeParse(rawPriority);
        if (!parsed.success) {
          throw new CliUsageError(`USAGE_ERROR：--priority 仅支持 普通 或 高（收到 "${rawPriority}"）`);
        }
        priority = parsed.data;
      }
      const rawMinutes = raw.singles.get('--today-minutes');
      const todayMinutes = rawMinutes !== undefined ? validatePositiveInt(rawMinutes, '--today-minutes') : undefined;
      if (priority === undefined && todayMinutes === undefined) {
        throw new CliUsageError('USAGE_ERROR：plan edit 至少要改一项：--priority 或 --today-minutes');
      }
      return {
        kind: 'call',
        json,
        method: 'update_plan_item',
        cardId: raw.positionals[0].trim(),
        day,
        priority,
        todayMinutes,
        operationId: validateOperationId(raw.singles.get('--operation-id')),
      };
    }

    if (sub === 'carry') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(['--keep-none']),
        singleFlags: new Set(['--day', '--operation-id']),
        multiFlags: new Set(['--keep']),
      });
      if (raw.positionals.length > 0) {
        throw new CliUsageError(`USAGE_ERROR：plan carry 不接受位置参数（收到 "${raw.positionals[0]}"）`);
      }
      const rawDay = raw.singles.get('--day');
      if (rawDay === undefined) {
        throw new CliUsageError('USAGE_ERROR：plan carry 必须提供 --day <YYYY-MM-DD>');
      }
      const day = validateIsoDate(rawDay, '--day');
      const keepNone = raw.booleans.has('--keep-none');
      const keepList = raw.multis.get('--keep');
      if (keepNone && keepList !== undefined) {
        throw new CliUsageError('USAGE_ERROR：--keep-none 不能与 --keep 同时使用');
      }
      if (!keepNone && (!keepList || keepList.length === 0)) {
        throw new CliUsageError('USAGE_ERROR：plan carry 必须明确指定 --keep <card-id>（可多次）或 --keep-none');
      }
      const keepCardIds = keepNone
        ? []
        : keepList!.map(id => {
            const trimmed = id.trim();
            if (!trimmed) throw new CliUsageError('USAGE_ERROR：--keep 的卡片 ID 不能为空');
            return trimmed;
          });
      if (new Set(keepCardIds).size !== keepCardIds.length) {
        throw new CliUsageError('USAGE_ERROR：--keep 不能包含重复的卡片 ID');
      }
      return {
        kind: 'call',
        json,
        method: 'confirm_plan_carry',
        day,
        keepCardIds,
        operationId: validateOperationId(raw.singles.get('--operation-id')),
      };
    }

    if (sub === 'skip-today') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(['--day', '--operation-id']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length > 0) {
        throw new CliUsageError(`USAGE_ERROR：plan skip-today 不接受位置参数（收到 "${raw.positionals[0]}"）`);
      }
      const rawDay = raw.singles.get('--day');
      if (rawDay === undefined) {
        throw new CliUsageError('USAGE_ERROR：plan skip-today 必须提供 --day <YYYY-MM-DD>');
      }
      return {
        kind: 'call',
        json,
        method: 'skip_today_plan',
        day: validateIsoDate(rawDay, '--day'),
        operationId: validateOperationId(raw.singles.get('--operation-id')),
      };
    }

    if (sub === 'draw') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(),
        multiFlags: new Set(),
      });
      if (raw.positionals.length > 0) {
        throw new CliUsageError(`USAGE_ERROR：plan draw 不接受位置参数（收到 "${raw.positionals[0]}"）`);
      }
      return { kind: 'call', json, method: 'draw_task_item' };
    }

    if (sub === 'skip') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(['--day', '--operation-id']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length !== 1 || raw.positionals[0].trim().length === 0) {
        throw new CliUsageError('USAGE_ERROR：plan skip 必须提供 1 个候选卡片 ID（如 monorail plan skip <card-id> --day <YYYY-MM-DD>）');
      }
      const rawDay = raw.singles.get('--day');
      if (rawDay === undefined) {
        throw new CliUsageError('USAGE_ERROR：plan skip 必须提供 --day <YYYY-MM-DD>');
      }
      return {
        kind: 'call',
        json,
        method: 'skip_task_item',
        cardId: raw.positionals[0].trim(),
        day: validateIsoDate(rawDay, '--day'),
        operationId: validateOperationId(raw.singles.get('--operation-id')),
      };
    }

    throw new CliUsageError(
      `USAGE_ERROR：未知子命令 "${`plan ${sub ?? ''}`.trim()}"；支持 plan show、plan add、plan remove、plan edit、plan carry、plan skip-today、plan draw、plan skip`,
    );
  }

  if (cmd === 'item') {
    const [sub, ...args] = subTokens;
    if (sub === 'done') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(['--finish-early', '--stdin']),
        singleFlags: new Set(['--note', '--note-file', '--operation-id', '--expected-state']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length !== 1 || raw.positionals[0].trim().length === 0) {
        throw new CliUsageError('USAGE_ERROR：item done 必须提供 1 个子任务卡片 ID（如 monorail item done <card-id>）');
      }
      const note = await resolveOptionalNoteInput(raw, options);
      return {
        kind: 'call',
        json,
        method: 'complete_task_item',
        cardId: raw.positionals[0].trim(),
        note,
        finishEarly: raw.booleans.has('--finish-early') ? true : undefined,
        operationId: validateOperationId(raw.singles.get('--operation-id')),
        expectedState: validateExpectedState(raw.singles.get('--expected-state')),
      };
    }

    if (sub === 'reopen') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(['--make-room', '--make-room-action', '--make-room-task', '--operation-id', '--expected-state']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length !== 1 || raw.positionals[0].trim().length === 0) {
        throw new CliUsageError('USAGE_ERROR：item reopen 必须提供 1 个子任务卡片 ID（如 monorail item reopen <card-id>）');
      }
      return {
        kind: 'call',
        json,
        method: 'reopen_task_item',
        cardId: raw.positionals[0].trim(),
        makeRoom: parseMakeRoomOption(raw),
        operationId: validateOperationId(raw.singles.get('--operation-id')),
        expectedState: validateExpectedState(raw.singles.get('--expected-state')),
      };
    }

    if (sub === 'keep') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(['--stdin']),
        singleFlags: new Set(['--note', '--note-file', '--operation-id', '--expected-state']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length !== 1 || raw.positionals[0].trim().length === 0) {
        throw new CliUsageError('USAGE_ERROR：item keep 必须提供 1 个当前卡片 ID（如 monorail item keep <card-id>）');
      }
      const note = await resolveOptionalNoteInput(raw, options);
      return {
        kind: 'call',
        json,
        method: 'keep_going_task_item',
        cardId: raw.positionals[0].trim(),
        note,
        operationId: validateOperationId(raw.singles.get('--operation-id')),
        expectedState: validateExpectedState(raw.singles.get('--expected-state')),
      };
    }

    if (sub === 'split') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(['--today-content', '--rest-content', '--rest-minutes', '--operation-id', '--expected-state']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length !== 1 || raw.positionals[0].trim().length === 0) {
        throw new CliUsageError('USAGE_ERROR：item split 必须提供 1 个当前卡片 ID（如 monorail item split <card-id> --today-content ... --rest-content ...）');
      }
      const todayContent = raw.singles.get('--today-content')?.trim();
      const restContent = raw.singles.get('--rest-content')?.trim();
      if (!todayContent || !restContent) {
        throw new CliUsageError('USAGE_ERROR：item split 必须同时提供非空的 --today-content 与 --rest-content');
      }
      const rawRestMinutes = raw.singles.get('--rest-minutes');
      const restMinutes = rawRestMinutes !== undefined ? validatePositiveInt(rawRestMinutes, '--rest-minutes') : undefined;
      return {
        kind: 'call',
        json,
        method: 'split_task_item',
        cardId: raw.positionals[0].trim(),
        todayContent,
        restContent,
        restMinutes,
        operationId: validateOperationId(raw.singles.get('--operation-id')),
        expectedState: validateExpectedState(raw.singles.get('--expected-state')),
      };
    }

    throw new CliUsageError(
      `USAGE_ERROR：未知子命令 "${`item ${sub ?? ''}`.trim()}"；支持 item done、item reopen、item keep、item split`,
    );
  }

  if (cmd === 'task') {
    const [sub, ...args] = subTokens;
    if (sub === 'create') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(['--items-stdin']),
        singleFlags: new Set(['--name', '--slot', '--default-project', '--items-file', '--operation-id']),
        multiFlags: new Set(['--item']),
      });
      if (raw.positionals.length > 0) {
        throw new CliUsageError(`USAGE_ERROR：task create 不接受位置参数（收到 "${raw.positionals[0]}"）；请使用 --name <name> --slot 主线|支线`);
      }
      const rawName = raw.singles.get('--name');
      const rawSlot = raw.singles.get('--slot');
      if (rawName === undefined || rawSlot === undefined) {
        throw new CliUsageError('USAGE_ERROR：task create 必须同时提供 --name <name> 与 --slot 主线|支线');
      }
      if (rawName.trim().length === 0) {
        throw new CliUsageError('USAGE_ERROR：--name 不能为空白');
      }
      const slotParsed = taskSlotSchema.safeParse(rawSlot);
      if (!slotParsed.success) {
        throw new CliUsageError(`USAGE_ERROR：--slot 仅支持 主线 或 支线（收到 "${rawSlot}"）`);
      }
      const rawProject = raw.singles.get('--default-project');
      if (rawProject !== undefined && rawProject.trim().length === 0) {
        throw new CliUsageError('USAGE_ERROR：--default-project 不能为空字符串');
      }
      const items = await resolveTaskItemsInput(raw, options, false);
      return {
        kind: 'call',
        json,
        method: 'create_task',
        name: rawName.trim(),
        slot: slotParsed.data,
        ...(rawProject !== undefined ? { defaultProject: rawProject.trim() } : {}),
        ...(items !== undefined ? { items } : {}),
        operationId: validateOperationId(raw.singles.get('--operation-id')),
      };
    }
    if (sub === 'show') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(),
        multiFlags: new Set(),
      });
      if (raw.positionals.length !== 1 || raw.positionals[0].trim().length === 0) {
        throw new CliUsageError('USAGE_ERROR：task show 必须提供 1 个任务 ID（如 monorail task show <task-id>）');
      }
      return { kind: 'call', json, method: 'get_task_details', taskId: raw.positionals[0].trim() };
    }

    if (sub === 'done') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(),
        singleFlags: new Set(['--operation-id', '--expected-state']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length !== 1 || raw.positionals[0].trim().length === 0) {
        throw new CliUsageError('USAGE_ERROR：task done 必须提供 1 个任务 ID（如 monorail task done <task-id>）');
      }
      return {
        kind: 'call',
        json,
        method: 'complete_task',
        taskId: raw.positionals[0].trim(),
        operationId: validateOperationId(raw.singles.get('--operation-id')),
        expectedState: validateExpectedState(raw.singles.get('--expected-state')),
      };
    }

    if (sub === 'reopen') {
      const raw = parseTokens(args, {
        booleanFlags: new Set(['--legacy']),
        singleFlags: new Set(['--completion-id', '--make-room', '--make-room-action', '--make-room-task', '--operation-id', '--expected-state']),
        multiFlags: new Set(),
      });
      if (raw.positionals.length !== 1 || raw.positionals[0].trim().length === 0) {
        throw new CliUsageError('USAGE_ERROR：task reopen 必须提供 1 个任务 ID（如 monorail task reopen <task-id> --completion-id <uuid>）');
      }
      const isLegacy = raw.booleans.has('--legacy');
      const rawCompletionId = raw.singles.get('--completion-id');
      if (isLegacy && rawCompletionId !== undefined) {
        throw new CliUsageError('USAGE_ERROR：--legacy 不能与 --completion-id 同时使用');
      }
      if (!isLegacy && rawCompletionId === undefined) {
        throw new CliUsageError('USAGE_ERROR：task reopen 必须提供 --completion-id <uuid>（来自 monorail task show）或 --legacy（无快照旧完成任务）');
      }
      let completionId: string | null = null;
      if (rawCompletionId !== undefined) {
        const parsed = z.uuid().safeParse(rawCompletionId);
        if (!parsed.success) {
          throw new CliUsageError(`USAGE_ERROR：--completion-id 必须是合法的 UUID（收到 "${rawCompletionId}"）`);
        }
        completionId = parsed.data;
      }
      return {
        kind: 'call',
        json,
        method: 'reopen_task',
        taskId: raw.positionals[0].trim(),
        completionId,
        makeRoom: parseMakeRoomOption(raw),
        operationId: validateOperationId(raw.singles.get('--operation-id')),
        expectedState: validateExpectedState(raw.singles.get('--expected-state')),
      };
    }

    throw new CliUsageError(
      `USAGE_ERROR：未知子命令 "${`task ${sub ?? ''}`.trim()}"；支持 task create、task show、task done、task reopen`,
    );
  }

  if (cmd === 'recap') {
    const [sub, ...args] = subTokens;
    if (sub !== 'show') {
      throw new CliUsageError(`USAGE_ERROR：未知子命令 "${`recap ${sub ?? ''}`.trim()}"；支持 recap show`);
    }
    const raw = parseTokens(args, {
      booleanFlags: new Set(['--include-idle']),
      singleFlags: new Set(['--period', '--from', '--to', '--dimension', '--bucket']),
      multiFlags: new Set(),
    });
    if (raw.positionals.length > 0) {
      throw new CliUsageError(`USAGE_ERROR：recap show 不接受位置参数（收到 "${raw.positionals[0]}"）`);
    }
    const rawPeriod = raw.singles.get('--period');
    let period: RecapPeriodOption | undefined;
    if (rawPeriod !== undefined) {
      const parsed = recapPeriodSchema.safeParse(rawPeriod);
      if (!parsed.success) {
        throw new CliUsageError(
          `USAGE_ERROR：--period 仅支持 week、lastWeek、cycle、month、quarter、year 或 custom（收到 "${rawPeriod}"）`,
        );
      }
      period = parsed.data;
    }
    const rawFrom = raw.singles.get('--from');
    const rawTo = raw.singles.get('--to');
    const from = rawFrom !== undefined ? validateIsoDate(rawFrom, '--from') : undefined;
    const to = rawTo !== undefined ? validateIsoDate(rawTo, '--to') : undefined;
    if (period === 'custom') {
      if (!from || !to) {
        throw new CliUsageError('USAGE_ERROR：--period custom 时必须同时提供 --from <YYYY-MM-DD> 与 --to <YYYY-MM-DD>');
      }
    } else if (from !== undefined || to !== undefined) {
      throw new CliUsageError('USAGE_ERROR：非 custom 周期不能传 --from 或 --to');
    }
    const rawDimension = raw.singles.get('--dimension');
    let dimension: RecapDimensionOption | undefined;
    if (rawDimension !== undefined) {
      const parsed = recapDimensionSchema.safeParse(rawDimension);
      if (!parsed.success) {
        throw new CliUsageError(
          `USAGE_ERROR：--dimension 仅支持 project、tag、source 或 activity（收到 "${rawDimension}"）`,
        );
      }
      dimension = parsed.data;
    }
    const rawBucket = raw.singles.get('--bucket');
    if (rawBucket !== undefined && rawBucket.trim().length === 0) {
      throw new CliUsageError('USAGE_ERROR：--bucket 不能为空字符串');
    }
    return {
      kind: 'call',
      json,
      method: 'get_recap',
      period,
      from,
      to,
      dimension,
      includeIdle: raw.booleans.has('--include-idle') ? true : undefined,
      bucket: rawBucket?.trim(),
    };
  }

  if (cmd === 'history') {
    const [sub, ...args] = subTokens;
    if (sub !== 'list') {
      throw new CliUsageError(`USAGE_ERROR：未知子命令 "${`history ${sub ?? ''}`.trim()}"；支持 history list`);
    }
    const raw = parseTokens(args, {
      booleanFlags: new Set(),
      singleFlags: new Set([
        '--from-day',
        '--to-day',
        '--source',
        '--agent',
        '--filter-agent',
        '--method',
        '--subject-type',
        '--subject-id',
        '--operation-id',
      ]),
      multiFlags: new Set(),
    });
    if (raw.positionals.length > 0) {
      throw new CliUsageError(`USAGE_ERROR：history list 不接受位置参数（收到 "${raw.positionals[0]}"）`);
    }
    const rawFromDay = raw.singles.get('--from-day');
    const rawToDay = raw.singles.get('--to-day');
    const fromDay = rawFromDay !== undefined ? validateIsoDate(rawFromDay, '--from-day') : undefined;
    const toDay = rawToDay !== undefined ? validateIsoDate(rawToDay, '--to-day') : undefined;
    if (fromDay !== undefined && toDay !== undefined && fromDay > toDay) {
      throw new CliUsageError(`USAGE_ERROR：--from-day (${fromDay}) 不能晚于 --to-day (${toDay})`);
    }
    const rawSource = raw.singles.get('--source');
    let source: HistorySourceOption | undefined;
    if (rawSource !== undefined) {
      const parsed = historySourceSchema.safeParse(rawSource);
      if (!parsed.success) {
        throw new CliUsageError(
          `USAGE_ERROR：--source 仅支持 manual、system、mcp、cli、automation 或 all_automation（收到 "${rawSource}"）`,
        );
      }
      source = parsed.data;
    }
    const agentFlag = raw.singles.get('--agent');
    const filterAgentFlag = raw.singles.get('--filter-agent');
    if (agentFlag !== undefined && filterAgentFlag !== undefined) {
      throw new CliUsageError('USAGE_ERROR：history list 中 --agent 与 --filter-agent 不能同时指定');
    }
    const rawFilterAgent = filterAgentFlag ?? agentFlag;
    if (rawFilterAgent !== undefined && rawFilterAgent.trim().length === 0) {
      throw new CliUsageError('USAGE_ERROR：调用方筛选名称不能为空');
    }
    const rawFilterMethod = raw.singles.get('--method');
    if (rawFilterMethod !== undefined && rawFilterMethod.trim().length === 0) {
      throw new CliUsageError('USAGE_ERROR：--method 不能为空字符串');
    }
    const rawSubjectType = raw.singles.get('--subject-type');
    let subjectType: HistorySubjectTypeOption | undefined;
    if (rawSubjectType !== undefined) {
      const parsed = historySubjectTypeSchema.safeParse(rawSubjectType);
      if (!parsed.success) {
        throw new CliUsageError(
          `USAGE_ERROR：--subject-type 仅支持 entry、card、task、record、review、settings 或 state（收到 "${rawSubjectType}"）`,
        );
      }
      subjectType = parsed.data;
    }
    const rawSubjectId = raw.singles.get('--subject-id');
    if (rawSubjectId !== undefined && rawSubjectId.trim().length === 0) {
      throw new CliUsageError('USAGE_ERROR：--subject-id 不能为空字符串');
    }
    return {
      kind: 'call',
      json,
      method: 'list_operation_history',
      fromDay,
      toDay,
      source,
      filterAgent: rawFilterAgent?.trim(),
      filterMethod: rawFilterMethod?.trim(),
      subjectType,
      subjectId: rawSubjectId?.trim(),
      operationId: validateOperationId(raw.singles.get('--operation-id')),
    };
  }

  if (cmd === 'entry') {
    const [sub, ...args] = subTokens;
    if (sub !== 'edit') {
      throw new CliUsageError(`USAGE_ERROR：未知子命令 "${`entry ${sub ?? ''}`.trim()}"；支持 entry edit <entry-id>`);
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
        `USAGE_ERROR：未知子命令 "${`operation ${sub ?? ''}`.trim()}"；请使用 monorail operation get <operation-id>`,
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
