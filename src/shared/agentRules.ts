/**
 * 给 agent 的规则（0.3.1 附带需求第 2 条，执行方案 G8）：CLI / MCP 做不到时回来告诉用户，不能自己改数据文件。
 * 起因：2026-11-05 一个 agent 找不到「改已有计时记录」的命令，直接改了 timelog/*.md，单轨之后报 External edit。
 * 一份文案，几处共用：MCP 握手说明 instructions、get_context 描述、CLI --help 开头（--help --json 的 rules 字段）、
 * 未知命令报错和 CliUsageError 默认下一步、mcp/README.md 与 docs/application/README.md。
 * 这只是提示词层面的约束，挡不住执意绕过；真正禁止要换账号运行 agent，本版不做。
 */
export const AGENT_RULES =
  '单轨的数据目录（timelog/、records/、cards/、tasks/、plans/、history/ 等）只能由单轨程序读写。' +
  '直接修改这些文件不会记入操作历史，还会让单轨之后的操作报「External edit」而失败。' +
  '如果 CLI 没有你需要的命令、MCP 没有你需要的工具或权限，请停下并告诉用户：做不到，缺的是什么功能。' +
  '不要改文件、写脚本或用其他办法绕过。';

/** 报错的「下一步」里用的短句：CLI 没有这个功能时怎么办。 */
export const AGENT_RULES_NEXT_STEP =
  '如果 CLI 没有你需要的功能，请停下并告诉用户做不到、缺什么；不要直接改单轨数据目录里的文件，也不要写脚本绕过';
