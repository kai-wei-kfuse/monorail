# ADR 0010：SDK v2 双时代传输基线

状态：Accepted · 2026-11-03 · M4 实际互操作验证。

## 决定与依据
生产依赖锁定 `@modelcontextprotocol/server@2.4.0`、`@modelcontextprotocol/node@2.1.2`。Node 包 peer 要求 server ^2.4.0，各包版本并非同步编号。`client@2.4.0` 与旧 `sdk@1.32.2` 只作为测试依赖。

用 `createServer(DesktopClient)` 定义一套工具，`serveStdio(factory,{legacy:'serve'})` 同时支持新旧 stdio；`createMcpHandler(factory,{legacy:'stateless'})` + `toNodeHandler` 同时服务两代 HTTP。不手写协议降级。旧 HTTP 为官方无状态模式，不实现会话存储、旧双端点 HTTP+SSE 或新增鉴权服务器。

现代 Client 必须启用 `versionNegotiation:{mode:'auto'}`，否则 v2 Client 默认仍走 legacy。测试已断言实际协议时代为 modern，版本为 2026-07-28；另用真实旧 SDK Client 验证 2025 调用。

## HTTP 边界
仅显式 `--http --port <port>` 启用；绑定 127.0.0.1，Host 由 SDK helper 验证，默认拒绝任何浏览器 Origin（包括空值/null/任意 localhost）。这是已接受本机 HTTP 安全要求，不提供公网接口。库函数允许显式精确 Origin 白名单；当前 CLI 不开放浏览器集成，也未宣称支持 CORS。

HTTP 请求体遵循 SDK 两层适配器默认 4 MiB 限制，不截断：超出返回 413。`HttpOptions.maxRequestBodySize` 同时传给两层，可按实际客户端需求调整；未另加生成期限、重试次数或文字长度限制。

## 验证
`mcp/compatibility.test.ts` 覆盖 legacy/modern × stdio/HTTP 的发现、真实管道调用、空白/额外字段、业务失败、应用离线及错误后的连接可用性；额外检查 Host/Origin/path/畸形请求。

`evidence/0.2.6-mcp-native-result.json` 核对四组合调用真实隔离 Tauri 应用的 Markdown 输出，journal 清理且 state.yaml 不变。测试对端和原生证据分别报告，不混为一谈。

## 限制与后续
M4 保留 save_idea 原型契约。M5 才实现 operation receipt、取消/世代治理与后台启动；M9 才做真实聊天宿主与低成本模型验收。SDK 迁移不是整个 0.2.6 已完成。
