# 0.3.0-beta.3 开发执行方案（v1.2）与 ADR 0019：第二轮复核

日期：2026-11-04。审核人：coder-3。
结论：**通过（首轮 P1–P9 全部已关闭，无剩余阻塞项）**。`docs/stages/0.3.0-beta.3-execution-plan.md`（v1.2）与 `docs/adr/0019-operation-history.md` 可正式作为实施依据（可将 ADR 0019 状态更新为 Accepted 并按 E0 → E9 推进开发）。本轮仅新建本复核文件，未修改任何代码或方案原文。

---

## P1–P9 修订复核结果

### 1. 阻塞项复核（P1–P3 全部已关闭）

- **P1（快速记录条补写操作历史）— 已关闭**：
  - **修订核对**：执行方案 E8b.1（第 201–205 行）与 ADR 0019 §5（第 64–68 行）、兼容节（第 98–99 行）已改为：快速记录条保存时写入 `created_via: 'quickbar'`；`reconcile` 扫描 `created_via === 'quickbar' && !history_logged_at` 的记录（同时覆盖「待办」与「想法」），每条记录独立一个事务，生成卡片/任务（待办）、写入「快速记录条 · 捕获待办 / 保存想法」历史（`at` 与活动日取 `record.created_at`），并在同一事务内写入 `history_logged_at`。
  - **代码复核**：已通过 `git show v0.2.5:src/data/schemas.ts` 与 `git show v0.2.5:src/data/mdRepo.ts` 独立验证：`v0.2.5` 的 `recordSchema` 确为 `.passthrough()`，且 `MdRepo.write` 执行 `{ ...(original ? decode(original.text, path).meta : {}), ...value }` 合并写回，退回旧版读取与改写均不会报错或丢失字段。升级前的老记录、主窗口/MCP/CLI 新建记录及 180 天清理后的记录均不会误补或重复补写。
  - **实施细则提醒（非阻塞）**：在实现 `src/domain/history` 时，由于快速记录条的文件在 `reconcile` 事务开始前已存在于 `records/`，普通事务忽略 `history_logged_at` 簿记字段，而在 `quickbar` 补记事务中（`before.history_logged_at === undefined && after.history_logged_at !== undefined`）应将该 `RecordEntry` 作为本次新建的主体对象生成 `changes`，确保「保存想法」（无新卡片/任务产生）也能准确产出「新记录」改动项。

- **P2（设置合并的 `Journal` 契约）— 已关闭**：
  - **修订核对**：执行方案 E8a.2（第 176–177 行）、E8a.4（第 185 行）与 ADR 0019 §3（第 40–43 行）已明确：`historyRepo.rewrite(prev, next)` 沿用上一条的原相对路径 `prev.path`，将上一条实际落盘原文 `prev.rawText` 作为 `createWrite(prev.path, nextRawText, prev.rawText)` 的 `before`；仅在同设置项、同来源、同活动日、非 `dayBoundaryHour` 变更且 `<= 60 秒` 时合并，且仅在 `transact` 成功后更新 `Ctx` 内存中的 `rawText`，提交失败或主窗口重载后清空指针。完全符合 `Journal.run`（`src/data/journal.ts:24,34`）的逐字节校验契约。

- **P3（MCP 调用方按次注入与 HTTP 无状态模式处理）— 已关闭**：
  - **修订核对**：执行方案 E8b.2（第 208–210 行）与 ADR 0019 §6（第 74、77、79 行）已改为：`client.call(method, input, { signal?, origin? })` 支持按次传 `origin`；`mcp/server.ts` 的 `call()` 在每次工具调用时动态读取 `server.server.getClientVersion()`。
  - **对「不缓存 HTTP `initialize` 的 `clientInfo`」的判断**：**完全赞同 ADR 0019 第 6 条的决定**。在 `mcp/http.ts` 的无状态模式下，同一个本机 HTTP 端口可能同时被多个客户端连接且无会话隔离，若在进程内缓存最近一次 `initialize` 的 `clientInfo`，会把后一个无状态客户端的调用错误记到前一个客户端名下（伪造归属比显示「未识别」危害更大）。读不到时固定传 `origin: { kind: 'mcp', agent: { name: null, detected_by: 'none' } }` 并显示「MCP · 未识别」，既保留了 `MCP` 传输渠道标识，又保证了归属真实性。

---

### 2. 应改项与建议项复核（P4–P9 全部已关闭）

| 编号 | 复核结论 | 核对位置 |
|---|---|---|
| **P4**（手动来源随 `intent` 传递） | **已关闭**。已废除全局一次性来源标记，改为在 `run(ctx, work, at, intent)` 的 `intent.source` 中传入，日历/列表共用服务加可选 `page` 参数，消除了 `tempActivity` 双次提交与异步插队串台问题。 | 执行方案 E8a.4（第 183 行）、E8b.1（第 198–199 行）、ADR 0019 §5（第 61–62 行） |
| **P5**（回看并行分摊与待机过滤顺序） | **已关闭**。已明确规定「1. 先过滤待机/睡眠 → 2. 再切原子区间按 $\Delta t / k$ 分摊 → 3. 再分日分桶 → 4. 最后按维度累加（标签按 $1/n$ 分摊）」的固定顺序及对应单测。 | 执行方案 E6.1（第 134–139 行） |
| **P6**（`lastCompletedAt` 与 `Snapshot.reviews`） | **已关闭**。已在 `Snapshot` 中增加 `reviews: Review[]`，由 `recapService.query` 直接从 `ctx.snapshot()` 同步计算 `recapStart`，不改变 `ReviewSlice` 完成后的 `null` 语义，并补列了 `M3Preview.tsx` 的同步修改。 | 执行方案 E6.3–E6.4（第 146–147 行） |
| **P7**（历史目录一次列出与逐文件删除） | **已关闭**。`listDays` 与 `removeDaysBefore` 均改为只调一次 `fs.list('history', true)`，按文件逐个调 `fs.remove`，并在 `FileSystem` 增加可选 `removeEmptyDir`，兼容 `MemoryFs` 与 `tauriFs`。 | 执行方案 E8a.2（第 178–179 行）、E8d.1（第 228 行）、ADR 0019 §7（第 84 行） |
| **P8**（日历弹窗时间编辑报错通道） | **已关闭**。已统一为走 `TimeScreens.tsx` 的 `report` 全局错误提示、输入格回退原值，与列表页 `EntryRow` 保持一致。 | 执行方案 E4.3（第 101 行） |
| **P9**（路径、保留 `homeService.sleep`、`run` 范围与行号） | **已关闭**。文首路径已改为 `app/`；E2 明确保留 `homeService.sleep`；E8a.5 补齐 `LivePreview.tsx:42`、`verification/journal.ts:14` 与测试辅助 `runTx`；E8b.2 已修正 `applicationController.ts` 第 457–626 行。 | 执行方案第 3、74、186、207 行 |

---

## 核验记录

- **实际读取并核对的文件**：
  - `docs/stages/0.3.0-beta.3-execution-plan.md`（v1.2 全文，重点核对 E2、E4.3、E6.1–E6.4、E8a.2–E8a.5、E8b.1–E8b.2、E8d.1 及第 9 节审核记录）
  - `docs/adr/0019-operation-history.md`（全文，重点核对 §1、§3、§5、§6、§7、兼容与恢复、待审核问题 Q1–Q4 及验证节）
  - `docs/stages/0.3.0-beta.3.md`（v1.17）
  - `evidence/beta3-plan-review-round1.md`
- **实际运行的只读命令**：
  - `git show v0.2.5:src/data/schemas.ts`、`git show v0.2.5:src/data/mdRepo.ts`（验证 `v0.2.5` 对 `records/*.md` 新增可选字段 `created_via` 与 `history_logged_at` 的 `.passthrough()` 解析及 `MdRepo.write` 原有字段合并保留行为）
  - `git status --short`（确认未修改任何已有文件）
- **未验证项**：
  - 本轮为方案复核，未修改代码、未运行构建或实机测试（留待 E1–E9 开发与验收阶段执行）。
