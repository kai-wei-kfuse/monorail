# ADR 0020：想法「已完成」的存法、规则与接口

状态：Accepted · 2026-11-05（用户确认需求 7 条，见 `docs/stages/0.3.0-beta.4.md` §1.3；用户授权直接开发并发 0.3.0 稳定版）。

## 背景

想法池要加〔完成〕按钮和「已完成」列表，可撤销；MCP / CLI 也能标记完成。

想法状态是记录的 `pool`：`活跃池 / 冷库 / 已转任务`，`src/data/schemas.ts` 用严格枚举校验，v0.2.5 与 0.3.0-beta.1–3 相同。v0.2.5 每次事务都读全部记录（`commit.ts` 的 `records.list()`），任何一条记录校验失败，整个事务失败。所以新增 `pool` 值会让退回 v0.2.5 的用户所有写操作失败。用户接受「退回 v0.2.5 时已完成的想法显示成冷库想法」。

## 决定

1. **存法：不加 `pool` 枚举值。** 已完成的想法存成 `pool: 冷库`、`cold_since = completed_at`，另加两个字段：
   - `completed_at: ISO | null`：完成时刻；
   - `completed_by: { kind: 'manual' | 'mcp' | 'cli' | 'automation', agent: string | null } | null`：谁标的（只用于显示，取自这次操作的历史来源；自报、未验证）。
   两个字段在 schema 里是可选、可为 null，不加新的 refine（见第 5 条的往返）。v0.2.5 / 0.3.0-beta.* 的 `passthrough()` 原样保留它们。
2. **派生状态。** `src/domain/idea/pool.ts` 提供 `ideaStatus(record)`：`pool === 冷库 && completed_at !== null` 为「已完成」，否则就是 `pool`。所有判断冷库的地方都改用它，已完成的想法：
   - 不占想法池上限、不进擂台、不过期进冷库（本来就只看活跃池）；
   - 不出现在冷库捞取、不能被捞回（`coldOffer`、`reviveInTx`、冷库对决）；
   - 不在想法池列表里，单独出现在「已完成」列表，按 `completed_at` 新到旧。
3. **规则。**
   - 完成：只允许活跃池的想法。已转任务、冷库、已完成的拒绝（已完成的再标一次按 noop 成功处理，见第 4 条）。`last_touched_at = at`。
   - 撤销完成：只允许已完成的。回到活跃池，`cold_since / completed_at / completed_by` 清空，`last_touched_at = at`（算一次「动过」，不会马上过期）。池子满了也允许放回，下次回顾用擂台压回（沿用「池子允许暂时超过上限」）。
   - 其余改 `pool` 的转换（转任务、捞回、进冷库、对决）一律把 `completed_at / completed_by` 置空。
4. **共享应用接口新增写方法 `complete_idea`**（第 16 项方法，第 11 个写方法）：
   - 输入 `{ operation_id, idea_id }`；结果 `{ id, text, status: '已完成', completed_at, noop }`，`noop = true` 表示本来就已完成、没写盘。
   - 走 `runOperation`，同一 `operation_id` 重试按回执重放；找不到想法 `IDEA_NOT_FOUND`，不是活跃池 `IDEA_NOT_ACTIVE`（错误信息写明当前状态）。
   - MCP 工具 `complete_idea`；CLI `monorail idea done <idea_id>`。撤销完成不开放给 MCP / CLI（用户只要求能标记完成）。
   - `find_items` 的想法 `pool` 输出枚举加「已完成」（用 `ideaStatus`），`include_archived` 说明同步。这是输出约定的扩展，旧 MCP 客户端只多看到一个值。
5. **兼容与往返。**
   - 退回 v0.2.5 / 0.3.0-beta.*：已完成的想法是冷库想法，可能在每周回顾的冷库捞取里被拿出来；数据不丢。
   - 若在旧版里被捞回，文件变成 `pool: 活跃池` 且仍带 `completed_at`：本版按 `pool` 判断（不是冷库就不是已完成），下次任何改 `pool` 的转换会清掉这两个字段。不为此加 refine，免得旧版写出的合法文件在本版校验失败。
6. **操作历史。** 新动作 `idea.complete`（完成想法）、`idea.uncomplete`（撤销完成）、`auto.complete_idea`（完成想法）。比较字段「池」改用 `ideaStatus`，显示「活跃池 → 已完成」，不显示成「冷库」。

## 影响与验证

数据：`schemas.ts`、`domain/record/record.ts`；规则：`domain/idea/pool.ts`、`services/ideaService.ts`、`services/backpackProjection.ts`、`domain/history/compare.ts`、`shared/history.ts`；接口：`shared/application.ts`、`app/applicationController.ts`、`mcp/server.ts`、`cli/*`、`docs/application/README.md`、`mcp/README.md`、设置 09 能力列表；界面：`pages/backpack/IdeaPool.tsx`、`BackpackPage.tsx`。

单测覆盖：完成 / 撤销 / 拒绝的状态；已完成不进冷库捞取、不能捞回、不过期、不占上限；旧版捞回后的往返；历史显示；`complete_idea` 的重放、noop 与错误；`find_items` 的状态。实测：隔离身份下界面完成 / 撤销；v0.2.5 读带 `completed_at` 的记录（若隔离 0.2.5 可用）。
