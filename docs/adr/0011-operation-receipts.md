# ADR 0011：业务操作回执、提交后错误与桥接后台生命周期

状态：Accepted · 2026-11-03 · M5（M5a + M5b），落实 ADR 0009 与已通过的需求设计 §2.1、§5 B1/B2/N1。

## 不变量
MCP 写操作的业务变更与 receipt 必须进入同一份 journal。重试在原有提交队列内查找回执，命中时不执行领域用例、不写 state、不递增 revision、不发布投影。操作 ID 相同而命令/规范化参数不同，明确报 `OPERATION_CONFLICT`。

## 数据与接口（M5a）
新增独立 `receipts/<canonical-uuid>.json`，操作 ID 由服务签发 UUID，路径由数据层校验并统一小写规范化，不接收任意路径。receipt 包含格式版本、操作 ID、命令、规范化输入和 JSON 结果、提交时间。

共享 JSON schema 严格校验；按 ID 直接读，不扫描全目录、不设无依据的条数/天数自动盲删。`runOperation` 与既有 `run` 使用同一内部队列和提交实现；`run` 保留旧 service 返回类型。共用 `saveRecordInTx` 用例供原保存入口和 MCP 操作使用，不套两个根事务。

`save_idea` 正式参数包含必填 `operation_id`。`get_context` 签发可复制 ID；成功写操作返回 `committed`、`data`、`replayed`、`warnings` 和 `next_operation_id`。`get_operation_result` 在同一队列内核对已完成提交，区分 `committed` / `not_found`；队列处于部分写入故障时不把不完整状态当已成功，明确要求重启恢复。

## 提交后故障
journal 失败仍使队列阻塞，需要恢复。journal 成功后的 settings listener、projection publish、reminders 与 logging 故障分类收集：MCP 返回已提交结果及 `warnings`，日志显式记录；不能说未保存。普通 UI 的 `run` 保留失败上报，但抛出明确“数据已提交，后续处理失败”错误，防止诱导重复保存。查询回执证明持久化结果，不承诺历史副作用已成功；重放返回 `replayed: true` 与 `warnings: []` 仅表示当次重放无新副作用，回执不被二次事务重写。

## 桥接生命周期、取消与按需后台启动（M5b）
1. **Rust `setup()` 早建管道与状态机**：应用启动时在 `mcp_bridge::setup` 即创建命名管道监听并写入 `mcp-host.json`（记录当前可执行文件路径、identifier 与 pipe 名），维护 `Starting / SetupRequired / Recovering / Ready { generation } / Failed / HostLost` 状态。未初始化数据目录时直接返回 `SETUP_REQUIRED`；启动恢复或数据校验失败时由前端通知 `start_mcp_bridge({ error })` 转入 `Failed` 并立即唤醒等待连接返回 `RECOVERY_FAILED`。
2. **按需 `--background` 启动**：`lib.rs` 在创建窗口前检查 `--background` 参数并将 `main` 窗口设为 `visible: false`，杜绝闪窗与抢焦点；`tauri_plugin_single_instance` 对带 `--background` 的二次启动直接收敛返回，不唤醒窗口。`mcp/pipe.ts` 仅在管道连接返回 `ENOENT` 时校验 `config.json` 与 `mcp-host.json` 并拉起 `--background`（进程内并发请求共享同一次启动等待），权限错误（`EACCES`/`EPERM`）与配置损坏（`CONFIG_CORRUPTED`）直接报错，不盲目拉起进程。
3. **读写门控分离与统一更新屏障**：只读方法（`get_context`、`get_operation_result` 等）通过 `quick_save::check_ready` 校验非迁移/非更新安装状态，不进入 `QuickSaves.active`；写方法进入 `QuickSaves.active`，且 `prepare_update_install` 阶段即置位 `installing` 阻断新请求，消除前端 `pauseCommits` 与原生 `prepare_install` 之间的窗口期。
4. **取消与宿主丢失安全边界**：请求在等待应用就绪或排队尚未进入事务执行前支持客户端取消（`AbortSignal` / 管道断开触发 `mcp-cancel`）；一旦进入事务执行与 journal 提交阶段则不可取消，继续完成并落盘回执，`QuickSaves` 仅在收到对应世代的 `respond_mcp` 后释放。若主窗口在存在未完成写入时重载或销毁，桥接转入 `HostLost`，拒绝新请求、向挂起请求返回 `RESULT_UNKNOWN`，且不提前释放 `QuickSaves` 写锁，须经完整进程重启恢复 journal 后再核对回执。

## 兼容与恢复
不改变 `state.yaml` `schemaVersion: 2` 或已有实体。缺少 `receipts` 目录表示尚无回执；坏文件抛错不掩盖。恢复沿用 `journal.recover` 后再开放 `Ready`。
