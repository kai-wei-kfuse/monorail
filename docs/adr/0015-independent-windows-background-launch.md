# ADR 0015：Windows 后台启动脱离 MCP 宿主进程树

状态：Accepted · 2026-11-03。用户授权继续完成 M9；真实模型/客户端测试暴露生命周期缺陷，本决定修复已承诺的后台运行行为，不扩大产品能力范围。

## 问题与证据

`client/pipe.ts` 原实现用 Node `spawn(exe, ['--background'], { detached: true })`。在 Codex CLI 0.162.0 的 Windows 原生 stdio MCP 会话中，四轮冷启动均能隐藏窗口、唯一实例并真实保存，但客户端退出后后台进程全部消失。SDK 客户端关闭则后台仍存在。

无害进程对照显示 Codex 的 MCP 启动环境有 Job/进程树清理，Node detached 不足以建立独立生命周期；使用本机 Windows WMI 进程服务创建的目标由 WmiPrvSE 承担父进程，在相同客户端退出后仍存活。详见 `evidence/m9-suite/fault-job-analysis.md`、`fault-job-experiment-result.json`、`cold-results.json`。

## 选项

1. 保留 direct detached：改动少，但已实际违反客户端结束后计时继续的要求。
2. 要求所有此类宿主改用独立 HTTP MCP：已有能力且四轮验证通过；是可选显式部署方式，不能用来掩盖默认 stdio 的行为缺陷。
3. 在 Windows 应用客户端的启动适配层使用独立系统进程创建，保留实际后台进程启动失败/退出观测。采用此方案。

## 决定与约束

- 新增 Windows launcher，由短期 watcher 调用本机 Win32_Process.Create 启动固定 `--background` 模式。目标脱离 MCP 宿主的进程树；业务唯一所有者仍是原单轨后台，不新增业务服务或第二写入者。
- watcher 持有实际目标进程对象并等待退出，启动失败、服务不可用、目标在 ready 前退出均明确报告；不能把系统创建返回成功视为应用 ready。
- 继续用现有 pipe ready 和错误语义、合并冷启动、用户取消和 `options.spawnProcess` 测试注入。连通实际管道后释放 watcher，不能结束已启动后台。
- 路径通过结构化参数或环境变量进入固定脚本，不拼用户可控 PowerShell 代码。不添加静默 direct-spawn 回退，也不添加任意启动期限或重试上限。
- Windows 服务/组件不可用时显式失败；文档说明新增启动实现及依赖，HTTP 仍是明确选择的可选入口。
- 公共应用契约、MCP 工具、CLI 用法、持久化 schema 均不变。MCP 与 CLI 共用客户端，因此一起获得修复。

## 验证

必须验证真实应用位于用户可用的 Windows 会话、管道 ready、中文/空格/特殊路径安全、无效启动/目标退出、取消和并发单实例；真实 Codex stdio 两模型各两轮退出后仍保留后台及计时。复跑受影响协议/CLI/类型/lint/构建检查。不得仅凭 dummy 实验勾选 M9。

## 影响

启动从直接 Node 子进程创建改为显式 Windows 系统进程服务创建，增加 watcher 启动成本，换取后台生命周期独立。新增失败路径应准确可诊断。保留所有失败前证据，修复后复测结果单独记录。
