import { McpServer } from '@modelcontextprotocol/server';
import {
  addTimeEntryInput,
  addTimeEntryResult,
  captureTodoInput,
  captureTodoResult,
  completeIdeaInput,
  completeIdeaResult,
  contextInput,
  contextResult,
  findItemsInput,
  findItemsResult,
  ideaInput,
  listTimeEntriesInput,
  listTimeEntriesResult,
  lookupInput,
  lookupResult,
  saveIdeaResult,
  startBreakInput,
  startTaskItemInput,
  startTimerInput,
  timeSummaryInput,
  timeSummaryResult,
  timerControlInput,
  timerMutationResult,
} from '../src/shared/application.ts';
import type { ApplicationInput, ApplicationMethod } from '../src/shared/application.ts';
import { z } from 'zod';
import type { ApplicationClient } from '../client/applicationClient.ts';
import { applicationErrorSchema, applicationFailure } from '../src/shared/appError.ts';
import { mcpAgent } from '../src/shared/agents.ts';
import pkg from '../package.json' with { type: 'json' };

const { version } = pkg;
/** 新协议请求信封里的 clientInfo 键（MCP 规范 2026-07-28 的 `_meta`）。 */
const CLIENT_INFO_KEY = 'io.modelcontextprotocol/clientInfo';
interface ToolContext { mcpReq: { signal?: AbortSignal; envelope?: unknown } }
const withError = <T extends z.ZodType>(schema: T) => z.union([schema, applicationErrorSchema]);

export function createServer(client: ApplicationClient) {
  const server = new McpServer({ name: 'monorail', version });
  // 调用方（ADR 0019 第 6 条）：每次工具调用时读，不缓存。新协议（2026-07-28）每个请求的 _meta 里都带 clientInfo；
  // 旧协议取 initialize 握手的；旧协议的无状态 HTTP 每个请求新建 server，两者都读不到，记「MCP · 未识别」
  const call = async <M extends ApplicationMethod>(method: M, args: ApplicationInput<M>, ctx: ToolContext) => {
    try {
      const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
      const info = (envelope?.[CLIENT_INFO_KEY] as { name?: unknown; version?: unknown } | undefined) ?? server.server.getClientVersion();
      const origin = { kind: 'mcp' as const, agent: mcpAgent(info) };
      const result = await client.call(method, args, { signal: ctx.mcpReq.signal, origin });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      const failure = applicationFailure(error);
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(failure) }], structuredContent: failure };
    }
  };

  server.registerTool('get_context', {
    title: '获取单轨当前上下文',
    description: '读取单轨当前计时状态、待处理通知（pending_actions）、可用项目/标签，并签发可复制的 operation_id 与 expected_state。冷调用写工具前先调用本工具；不要自行伪造 UUID 或状态令牌。示例输入：{}',
    inputSchema: contextInput,
    outputSchema: withError(contextResult),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (args, ctx) => call('get_context', args, ctx));

  server.registerTool('get_operation_result', {
    title: '核对单轨操作结果',
    description: '连接中断或结果未知时，用原 operation_id 查询是否已持久化提交。返回 committed 证明业务数据已落盘（不反映历史后置提醒状态）；查询报错不等于未保存。',
    inputSchema: lookupInput,
    outputSchema: withError(lookupResult),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (args, ctx) => call('get_operation_result', args, ctx));

  server.registerTool('save_idea', {
    title: '保存想法到单轨',
    description: '当用户要求记下想法或保存聊天中的灵感时调用（进入想法池，不创建待办任务、不开始计时）。operation_id 复制自 get_context 或上次结果的 next_operation_id；重试必须沿用原 ID。',
    inputSchema: ideaInput,
    outputSchema: withError(saveIdeaResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('save_idea', args, ctx));

  server.registerTool('capture_todo', {
    title: '捕捉待办事项到单轨',
    description: '当用户要求记一个待办事项时调用（创建待办记录并生成事项卡片，缺省归入单事项支线任务，不改变当前计时）。不要用 save_idea 代替待办捕捉。',
    inputSchema: captureTodoInput,
    outputSchema: withError(captureTodoResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('capture_todo', args, ctx));

  server.registerTool('find_items', {
    title: '查找想法、待办卡片与任务',
    description: '按关键词或类别查找单轨中的想法（idea）、待办事项卡（todo_card）与背包任务（task）。当 ambiguous=true（命中多项重名或近似项）时，必须向用户确认或展示候选，不要猜测第一个 ID 执行写操作。',
    inputSchema: findItemsInput,
    outputSchema: withError(findItemsResult),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (args, ctx) => call('find_items', args, ctx));

  server.registerTool('get_time_summary', {
    title: '获取单轨时间统计摘要',
    description: '分析今天（today）、昨天（yesterday）、本周（this_week）或指定日期（YYYY-MM-DD）的时间使用情况。返回非待机覆盖时长（non_idle_covered_ms，含睡眠/离线，不等同于工作时长）、待机时长（idle_ms）、并行重叠量（overlap_excess_ms）、真实未记录空白（untracked_ms）及按项目/标签汇总。',
    inputSchema: timeSummaryInput,
    outputSchema: withError(timeSummaryResult),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (args, ctx) => call('get_time_summary', args, ctx));

  server.registerTool('list_time_entries', {
    title: '列出区间内的时间明细',
    description: '按明确的起止时间（带时区 ISO 字符串 from/to）返回完整计时明细及区间内裁切时长（clipped_ms），不截断合法结果。',
    inputSchema: listTimeEntriesInput,
    outputSchema: withError(listTimeEntriesResult),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (args, ctx) => call('list_time_entries', args, ctx));

  server.registerTool('start_timer', {
    title: '开始或切换自由活动计时',
    description: '开始一项自由活动计时（若已有普通计时则在同一时刻切换）。需复制最新的 operation_id 与 expected_state；若要开始已有的待办事项卡片，请改用 start_task_item。',
    inputSchema: startTimerInput,
    outputSchema: withError(timerMutationResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('start_timer', args, ctx));

  server.registerTool('start_task_item', {
    title: '开始指定待办事项卡片计时',
    description: '对指定的待办事项卡片（card_id，通过 find_items 或 get_context 获取）开始计时并关联卡片进度。不要用 start_timer 伪造卡片计时。',
    inputSchema: startTaskItemInput,
    outputSchema: withError(timerMutationResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('start_task_item', args, ctx));

  server.registerTool('pause_timer', {
    title: '暂停当前计时',
    description: '暂停正在进行的普通活动或卡片计时，保留返回目标以便后续调用 resume_timer 继续。临时离开期间不可用（请先调用 return_from_break）。',
    inputSchema: timerControlInput,
    outputSchema: withError(timerMutationResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('pause_timer', args, ctx));

  server.registerTool('resume_timer', {
    title: '继续已暂停的计时',
    description: '从已暂停状态恢复原活动或卡片计时。若当前是临时离开（start_break），请改用 return_from_break。',
    inputSchema: timerControlInput,
    outputSchema: withError(timerMutationResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('resume_timer', args, ctx));

  server.registerTool('stop_timer', {
    title: '停止当前计时',
    description: '结束当前计时（或清除已暂停会话）并回到待机，不保留返回目标，同时释放进行中的卡片。',
    inputSchema: timerControlInput,
    outputSchema: withError(timerMutationResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('stop_timer', args, ctx));

  server.registerTool('start_break', {
    title: '开始临时离开活动',
    description: '在当前计时或待机期间插入短暂临时活动（如「上厕所」「吃饭」），底层原活动保持为返回目标，结束后调用 return_from_break 回来。',
    inputSchema: startBreakInput,
    outputSchema: withError(timerMutationResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('start_break', args, ctx));

  server.registerTool('return_from_break', {
    title: '从临时离开活动回来',
    description: '结束当前的临时离开活动（kind=插入），自动恢复离开前的原活动/卡片（若从待机插入则回到待机）。',
    inputSchema: timerControlInput,
    outputSchema: withError(timerMutationResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('return_from_break', args, ctx));

  server.registerTool('add_time_entry', {
    title: '手动补录时间记录',
    description: '补记一段过去已完成的时间记录（带时区 start/end）。保留与既有非待机记录的并行关系并返回重叠明细（overlaps），不覆盖已有非待机记录。',
    inputSchema: addTimeEntryInput,
    outputSchema: withError(addTimeEntryResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('add_time_entry', args, ctx));

  server.registerTool('complete_idea', {
    title: '把想法标记为已完成',
    description: '当用户说某个想法已经做到了、不用再转成任务时调用：想法离开想法池，进入「已完成」列表（用户可在单轨里撤销）。先用 find_items（kind=idea）查到准确的 idea_id；只有想法池里的想法能标记，已完成的再标记返回 noop=true。operation_id 复制自 get_context 或上次结果的 next_operation_id；重试沿用原 ID。',
    inputSchema: completeIdeaInput,
    outputSchema: withError(completeIdeaResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('complete_idea', args, ctx));

  return server;
}
