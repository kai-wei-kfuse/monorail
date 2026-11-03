# ADR 0014：统一应用接口、MCP 与 CLI 并列入口

状态：Accepted · 2026-11-03。用户明确要求 0.3.0 完成统一接口层、MCP、CLI，并交 coder-3 执行。完整任务定义见 `docs/application/0.3.0-execution-plan.md`。

## 背景
MCP 首批 15 项能力与 R1–R3/D1/D2 修复已存在。DesktopClient、应用 schema 和请求分派已经分开，但文件仍以 MCP 命名，返回校验在 MCP Server，公共调用类型仍返回 unknown。CLI 是确定的第二个消费者，需要真实复用能力而非复制规则。

## 决定

```text
MCP adapter ─┐
             ├→ ApplicationClient → Windows transport → ApplicationController → 原 services/commit/journal
CLI adapter ─┘
```

1. 公共契约（输入/成功输出/应用错误/操作元信息）独立于 MCP SDK、CLI parser、Node、Tauri 与 Windows 路径。现有 shared/operation.ts 与 shared/appError.ts 继续作为统一来源。
2. ApplicationClient 提供类型化调用、输入输出校验和错误还原；原始 transport 才能返回 unknown。MCP 与 CLI 不各写一套验证/后台启动代码。
3. ApplicationController 复用现有已修复的分派、快照读取、用例和事务；不新增业务状态所有者。桌面 UI 可继续直接调用现有 services，不强制 UI 经本机 IPC。
4. MCP 负责工具描述、annotations、协议与 MCP 结果封装；CLI 负责子命令/flags、stdin、终端/JSON 输出和退出码。两者互不调用，CLI 不启动 MCP Server，MCP 不 spawn CLI。
5. 两个入口共用 operation_id、expected_state、receipt 和错误语义。CLI 仅在调用编排时自动获取上下文，不能在状态冲突后悄悄刷新再执行。
6. 旧管道名称和 Rust 消息名称可保留以避免无收益的联动改名；它们是内部兼容路径，不代表新客户端依赖 MCP 协议。旧 TS 导入在同仓迁移完后删除，不长期维护镜像实现。

## 关键契约调整：CLI 重试
计时 receipt 的输入摘要含原 expected_state。CLI 使用显式 --operation-id 重试时不能重新获取并替换令牌。get_operation_result 在现有 receipt 基础上返回规范化原请求（command + input，不增第二份存储）。公共客户端/CLI据此恢复缺省技术字段，但用户本次业务参数仍必须参与比较；最后仍由原服务进行幂等/冲突判断。同 key 换正文/目标必须报冲突，不能仅查到回执就说成功。

不改变现有持久 receipt 格式；仅扩展查询的公开结果及相应 schema，记录兼容说明并重测新旧协议。若实现发现需要数据格式改变，按已有迁移纪律另记决定，不静默修改。

## 交付范围
同版交付现有 15 项能力的 MCP 与 CLI 两个入口、自包含 Node 24 包和配置/帮助说明。CLI 命令形式与 API 方法不必一对一。手机同步、远程云网关、复杂任务整理、TUI 等维持后续范围。

## 验收
必须有同方法不同入口的结果等价、跨入口操作 ID 重放/冲突、状态变化拒绝、后台冷启动、部分 journal 故障、特殊字段和值以及脱离源码树的发行验证。现有 471 项应用 + 8 项协议测试是迁移前基线，新增验证不能只断言导出/文件名。M9 的真实 AI 客户端与低价模型评测继续保留，不被 CLI 测试替代。
