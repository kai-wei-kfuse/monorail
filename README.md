# 任务终端：架构验证骨架

此工程验证真实文件、串行提交、窗口和后台系统能力，不是完整产品。目录遵循上级 `架构设计.md` v1.0；附件、完整选卡/降级/回顾、离线回答落账等尚未实现。

## 运行

- 使用 Node 24、已安装的 Rust 1.95.0 MSVC 工具链、Windows C++ 构建工具和 WebView2。
- `npm ci`
- `npm run check`：类型、分层/无环 lint、测试；测试进程硬上限 60 秒。
- `npm run tauri -- build --debug --no-bundle`：构建嵌入前端的 Windows 可执行文件，不启动开发服务器，不安装到系统。
- 程序：`src-tauri/target/debug/task-terminal-skeleton.exe`。首次启动用原生 dialog 选择数据目录。
- 快捷键初始为 Ctrl+Alt+Shift+R；可用进程环境变量 `TASK_TERMINAL_SHORTCUT` 显式设置。注册冲突显示错误，应用继续运行，不自动尝试其他组合。

## 集成验证构建

`npm run tauri -- build --debug --no-bundle --features verify --config src-tauri/tauri.verify.conf.json`

启动后先等日志中出现 `verification-ready-main` 和 `verification-ready-quickbar`，再运行同一 exe 加 `--verify-start`。它调用真实窗口和插件 API，记录条复用同一个保存函数。后台计时开始后保持主窗口隐藏至少 10 分钟，再运行不带参数的同一 exe 唤回；日志会核对时长。验证会暂时开关本应用自启并恢复原设置，不重启计算机、不让系统真实休眠。

验证入口位于 `src/verification/`，只由 Vite verify mode 引入；原生模拟电源和触发入口由 Cargo `verify` feature 编译隔离。普通生产前端包不包含验证入口，普通 Rust 构建没有对应命令处理器。

原生运行证据：`%APPDATA%/local.taskterminal.skeleton/evidence.jsonl`、`lifecycle.json`；本次归档在 `evidence/`。测试数据在 `.verification-data/`，不提交。

## 一致性约定

- service 经一个提交队列读取最新状态并分配 seq。写入 journal 先落盘，文件依次替换，重启先重放再 reconcile。
- 记录转卡的 ID 由记录 ID 推导。重复事件/重启重放不会创建第二张卡。
- seq 标识逻辑片段的覆盖优先级。跨日物理切片沿用相同 id/seq，必须互不重叠；不同逻辑片段不能复用 seq。
- 当前段以真实时间戳计算时长，JS 心跳只刷新显示。Rust 每分钟保存 last_alive，并在启动时保留 previous_last_alive。
- 运行中外部修改实体文件会被版本/内容比较拒绝；这里不实现在线协同编辑。

程序内 API 实测、真实用户触发路径与未测项分别见上级 `验证-技术骨架.md`，不能把 API 成功直接等同于通知弹窗可见或用户路径全部通过。
