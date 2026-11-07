import { McpServer } from '@modelcontextprotocol/server';
import {
  addPlanItemInput,
  addTimeEntryInput,
  addTimeEntryResult,
  updatePlanItemInput,
  updateTimeEntryInput,
  updateTimeEntryResult,
  captureTodoInput,
  captureTodoResult,
  completeIdeaInput,
  completeIdeaResult,
  completeTaskInput,
  completeTaskItemInput,
  completeTaskItemResult,
  completeTaskResult,
  confirmPlanCarryInput,
  contextInput,
  contextResult,
  drawTaskItemInput,
  drawTaskItemResult,
  endOriginalTaskInput,
  endOriginalTaskResult,
  findItemsInput,
  findItemsResult,
  getRecapInput,
  getRecapResult,
  getTaskDetailsInput,
  getTaskDetailsResult,
  getTaskPlanInput,
  getTaskPlanResult,
  ideaInput,
  keepGoingTaskItemInput,
  keepGoingTaskItemResult,
  listOperationHistoryInput,
  listOperationHistoryResult,
  listTimeEntriesInput,
  listTimeEntriesResult,
  lookupInput,
  lookupResult,
  planMutationResult,
  removePlanItemInput,
  reopenIdeaInput,
  reopenIdeaResult,
  reopenTaskInput,
  reopenTaskItemInput,
  reopenTaskItemResult,
  reopenTaskResult,
  saveIdeaResult,
  skipTaskItemInput,
  skipTodayPlanInput,
  splitTaskItemInput,
  splitTaskItemResult,
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
import { AGENT_RULES } from '../src/shared/agentRules.ts';
import pkg from '../package.json' with { type: 'json' };

const { version } = pkg;
/** 新协议请求信封里的 clientInfo 键（MCP 规范 2026-07-28 的 `_meta`）。 */
const CLIENT_INFO_KEY = 'io.modelcontextprotocol/clientInfo';
interface ToolContext { mcpReq: { signal?: AbortSignal; envelope?: unknown } }
const withError = <T extends z.ZodType>(schema: T) => z.union([schema, applicationErrorSchema]);

export function createServer(client: ApplicationClient) {
  // 握手说明：做不到时回来告诉用户，不能自己改数据文件（0.3.1 附带需求第 2 条）
  const server = new McpServer({ name: 'monorail', version }, { instructions: AGENT_RULES });
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
    description: '读取单轨当前计时状态、待处理通知（pending_actions）、可用项目/标签，并签发可复制的 operation_id 与 expected_state。冷调用写工具前先调用本工具；不要自行伪造 UUID 或状态令牌。示例输入：{}。' + AGENT_RULES,
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

  server.registerTool('update_time_entry', {
    title: '修改已有的时间记录',
    description: '改一条已有计时记录的开始、结束、描述、项目或标签（规则同单轨日历：正在计时的只能改开始；来自卡的描述和项目要在卡上改；开着的待机不能改描述和项目，要开始做事请用 start_timer）。不能删除记录。entry_id 来自 list_time_entries。返回的 overlaps 是新时段和这些已有记录重叠（并行保留，不改它们；被盖住的待机会让出来）。',
    inputSchema: updateTimeEntryInput,
    outputSchema: withError(updateTimeEntryResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('update_time_entry', args, ctx));

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

  server.registerTool('reopen_idea', {
    title: '撤销完成想法并放回想法池',
    description: '把已完成列表里的想法恢复回活跃想法池（即使想法池已满也允许恢复）。已处于想法池的想法重复调用返回 noop=true。',
    inputSchema: reopenIdeaInput,
    outputSchema: withError(reopenIdeaResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('reopen_idea', args, ctx));

  server.registerTool('get_task_plan', {
    title: '读取今天或明天的任务板',
    description: '读取今天（today）或明天（tomorrow）的任务板详情，包括实际活动日 YYYY-MM-DD、板子事项、优先级、今日目标分钟与已计分钟、待确认带入项（carry_pending）及可抽取候选（drawable_card_ids）。只读不建文件。',
    inputSchema: getTaskPlanInput,
    outputSchema: withError(getTaskPlanResult),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (args, ctx) => call('get_task_plan', args, ctx));

  server.registerTool('add_plan_item', {
    title: '将待办事项排入任务板',
    description: '把背包中的待办事项卡排入今天或明天（精确活动日 YYYY-MM-DD，先从 get_task_plan 获取）的任务板，可指定优先级与时间盒当天分钟数。',
    inputSchema: addPlanItemInput,
    outputSchema: withError(planMutationResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('add_plan_item', args, ctx));

  server.registerTool('remove_plan_item', {
    title: '从任务板移出事项',
    description: '从今天或明天的任务板移出指定事项卡片（卡片本身保留在背包中）；若不在板子上则返回 noop=true。',
    inputSchema: removePlanItemInput,
    outputSchema: withError(planMutationResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('remove_plan_item', args, ctx));

  server.registerTool('update_plan_item', {
    title: '修改任务板事项的优先级或今日目标量',
    description: '修改今天或明天任务板上已有事项的 priority（普通/高）或时间盒卡的 today_minutes（正整数分钟）。',
    inputSchema: updatePlanItemInput,
    outputSchema: withError(planMutationResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('update_plan_item', args, ctx));

  server.registerTool('confirm_plan_carry', {
    title: '确认昨天带入今天的任务板事项',
    description: '当今天任务板 carry_pending=true 时，显式指定要保留在今天板子上的带入卡片 ID 列表（keep_card_ids，全部不带传 []）。非带入的今日已排事项不受影响。',
    inputSchema: confirmPlanCarryInput,
    outputSchema: withError(planMutationResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('confirm_plan_carry', args, ctx));

  server.registerTool('skip_today_plan', {
    title: '今天先不排任务板（全背包抽卡）',
    description: '在今天任务板为空时标记「这次先不排」（skip_until_planned=true），允许直接从整个背包抽取待办事项。',
    inputSchema: skipTodayPlanInput,
    outputSchema: withError(planMutationResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('skip_today_plan', args, ctx));

  server.registerTool('draw_task_item', {
    title: '从今日任务板加权抽取一张事项卡',
    description: '只读按权重从今日任务板（或 skip_until_planned 下的全背包）抽取一张待办事项卡，不自动开始计时。若要开始抽到的卡请再调用 start_task_item；若要换一张请先调用 skip_task_item 再调用本工具。',
    inputSchema: drawTaskItemInput,
    outputSchema: withError(drawTaskItemResult),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (args, ctx) => call('draw_task_item', args, ctx));

  server.registerTool('skip_task_item', {
    title: '换一张（本轮抽卡跳过指定候选卡）',
    description: '将指定候选卡记入今日抽卡本轮已看过集合（seen_card_ids）；若所有候选都已看过则自动重开新一轮。跳过后请再调用 draw_task_item 抽取下一张。',
    inputSchema: skipTaskItemInput,
    outputSchema: withError(planMutationResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('skip_task_item', args, ctx));

  server.registerTool('complete_task_item', {
    title: '完成待办事项卡片（当前卡或背包待做子项）',
    description: '完成当前正在计时/已暂停的事项卡片（必填 expected_state；时间盒未达目标时长时需传 finish_early=true），或直接完成背包进行中任务下的待做子项（可省略 expected_state，不影响其他正在运行的计时）。',
    inputSchema: completeTaskItemInput,
    outputSchema: withError(completeTaskItemResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('complete_task_item', args, ctx));

  server.registerTool('reopen_task_item', {
    title: '取消完成单个子事项并恢复为待做',
    description: '将已完成的单个子事项卡片恢复为「待做」（校验主线活跃事项上限；若所属父任务处于已完成状态，则同一事务将父任务一并恢复回原槽位，满格时支持传 make_room 显式腾位）。',
    inputSchema: reopenTaskItemInput,
    outputSchema: withError(reopenTaskItemResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('reopen_task_item', args, ctx));

  server.registerTool('keep_going_task_item', {
    title: '接着做（记录进度并暂停放回待做）',
    description: '对首页当前正在做或已暂停的事项卡片写下进度笔记（note）、停止计时并将同一张卡放回待做（不新建续卡）。',
    inputSchema: keepGoingTaskItemInput,
    outputSchema: withError(keepGoingTaskItemResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('keep_going_task_item', args, ctx));

  server.registerTool('split_task_item', {
    title: '缩小拆分当前事项卡片',
    description: '将首页当前正在做或已暂停的事项卡片拆分为「今天先做的内容」（原卡继续计时）与「留到后面的剩余内容」（新卡排在后面待做）。',
    inputSchema: splitTaskItemInput,
    outputSchema: withError(splitTaskItemResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('split_task_item', args, ctx));

  server.registerTool('end_original_task', {
    title: '在插入活动期间结束原任务/原活动',
    description: '在临时离开/插入活动期间结束底层等待返回的原卡片或原自由计时，将当前插入活动转为普通自由记录继续计时，原卡片放回待做。',
    inputSchema: endOriginalTaskInput,
    outputSchema: withError(endOriginalTaskResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('end_original_task', args, ctx));

  server.registerTool('get_task_details', {
    title: '查看任务详情、子事项与完成/恢复信息',
    description: '读取指定主线或支线任务的完整详情、子事项列表、当前 completion_id、可恢复模式（reopen_mode）及槽位满格腾位候选（make_room_candidates）。',
    inputSchema: getTaskDetailsInput,
    outputSchema: withError(getTaskDetailsResult),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (args, ctx) => call('get_task_details', args, ctx));

  server.registerTool('complete_task', {
    title: '整张完成主线或支线任务',
    description: '将背包中进行中的整张主线或支线任务及其剩余待做/进行中子项一并标记为已完成，释放背包槽位并记录批次 completion_id（若任务含当前计时卡则必填 expected_state）。',
    inputSchema: completeTaskInput,
    outputSchema: withError(completeTaskResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('complete_task', args, ctx));

  server.registerTool('reopen_task', {
    title: '重新打开（撤销完成）已完成任务',
    description: '根据 get_task_details 返回的 completion_id 将已完成任务及其同批完成子项恢复回背包（旧版无快照任务显式传 completion_id=null）；若原槽位已满可通过 make_room 显式冷藏或放弃同槽位任务腾位。',
    inputSchema: reopenTaskInput,
    outputSchema: withError(reopenTaskResult),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, ctx) => call('reopen_task', args, ctx));

  server.registerTool('get_recap', {
    title: '查询时间回看统计',
    description: '按周期（week/lastWeek/cycle/month/quarter/year/custom）与维度（project/tag/source/activity）查询完整回看统计、分桶（buckets）、分组明细、上期对比、已完成卡片与进度笔记。',
    inputSchema: getRecapInput,
    outputSchema: withError(getRecapResult),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (args, ctx) => call('get_recap', args, ctx));

  server.registerTool('list_operation_history', {
    title: '查询操作历史记录',
    description: '按活动日范围（from_day/to_day，默认最近 7 天）及来源（source）、调用方（agent）、方法（method）、主体（subject_type/subject_id）或 operation_id 查询单轨操作历史与坏记录计数（bad_count）。',
    inputSchema: listOperationHistoryInput,
    outputSchema: withError(listOperationHistoryResult),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (args, ctx) => call('list_operation_history', args, ctx));

  return server;
}
