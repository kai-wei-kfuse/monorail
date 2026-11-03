# ADR 0008：MCP 经本机管道调用桌面服务

状态：Accepted · 2026-11-03 · 基于用户授权实现保存想法

## 背景与不变量
记录已有 createRecord、recordSchema、recordService.saveRecord、journal 与投影。外部入口不再定义一套存储或想法生命周期规则。成功应在 saveRecord 完成后返回，提交错误原样可见。

## 选项与决定
不选择独立进程写 Markdown：无法参与当前应用的更新/迁移协调。不选择 HTTP：当前仅 Windows 本机集成，没有远程访问需求。

使用官方 @modelcontextprotocol/sdk 的 stdio transport；Node 24 原生类型剥离运行独立 TS 入口。SDK 负责协商、发现、调用。Node 仅将经过 schema 验证的输入通过 Windows 命名管道交给桌面进程。

桌面管道名由 Tauri identifier 派生，生产为 `\\.\pipe\local.pixelrecord.app.mcp`。first_pipe_instance 防止已有同名服务时静默接管，reject_remote_clients 拒绝远程管道连接，采用 Windows 默认命名管道 DACL。此入口面向可信的本机用户进程，不是隔离同一用户恶意程序的安全沙箱。无需共享凭据或开放 TCP 端口。

Rust 仅转发 JSON、关联响应和管理保存会话，不构造业务记录。主窗口 app 适配层再次严格校验输入，调用 createRecord 与 saveRecord。原生 QuickSaves admission 阻止迁移/安装期间的新请求，并让安装更新等待已有保存完成。bootstrap 完成后才注册入口。

## 契约
`save_idea({text, needs?})`：text 去除首尾空白后非空；needs 可选。内容内的 #标签沿用 createRecord。由应用生成 UUID 与保存时间，写入现有想法池；返回 id、text、created_at、tags、pool。不接受路径、调用方 ID、执行计时或附件。

管道每个连接一个换行 JSON 请求及响应，连接断开可观察；不自动重试、不添加生成期限或长度截断。失败返回明确错误；已提交但响应中断属于结果未知，不能承诺重试幂等。管道响应仅在服务提交结束后发送，客户端断开不会撤销已接受的保存。

## 代价与验证
必须运行带新入口的单轨，旧版应用无法接入。初期通过绝对 Node 脚本路径配置客户端，暂不发布 npm 包。测试覆盖 schema、journal 实际写入、投影、不改变计时、错误传播、SDK 发现调用及管道失败。隔离原生构建使用不同 identifier/临时数据，禁止写日常目录。

## Revision History
| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-11-03 | 首次定义保存想法能力和本机桥接边界 |
