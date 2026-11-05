# 0.3.0-beta.3 隔离真窗口实测与 v0.2.5 兼容矩阵

2026-11-05 · 证据类型：**真窗口**（隔离身份的 debug exe，WebView2 调试端口驱动真窗口）与**隔离安装**（真 0.2.5 隔离 exe）。

## 环境与隔离

| 项 | 值 |
|---|---|
| 代码 | `b149571`（前端 `dist` 与 E9 构建同一份） |
| beta.3 隔离身份 | `local.pixelrecord.beta3test.tf8e4216de6a9`，productName `单轨Beta3隔离验收`；临时数据 `%TEMP%\monorail-b3-f8e4216de6a9\data`；只给这个目录 fs 权限 |
| 构建 | `tauri build --debug --no-bundle --config <隔离配置>`（`setup.mjs`），复制为 `Monorail-beta3-isolated.exe`；没有打包、没有安装 |
| 首次启动前 | 数据目录预置 `settings.yaml`：`autostart: false`、快捷键 `Ctrl+Alt+Shift+F11 / F12`；配置目录预置 `config.json` |
| 0.2.5 | 2026-11-01 已建好的隔离 exe（`local.pixelrecord.test025.tdb06cfcd51d6`，`%TEMP%\monorail-025-db06cfcd51d6`）。实测前把它原有的 `data` 挪开备份，结束后还原 |
| MCP / CLI | 本仓库 `dist-mcp/monorail-mcp.mjs`、`dist-cli/monorail-cli.mjs`，经 `MONORAIL_PIPE` / `MONORAIL_CONFIG_DIR` / `MONORAIL_EXECUTABLE` 指向隔离管道。**调用方是按公开名字模拟的**（clientInfo `claude-ai`、`CLAUDECODE=1`），不是真实的 Claude Desktop / Claude Code |
| 日常版 | 全程运行（PID 15080），只读不写。前后对比：Run 启动项相同、日常 exe 与 `config.json` 的 SHA-256 相同、PID 相同（`baseline-before.json`、`baseline-after.json`、`cleanup.json`） |
| 收尾 | 隔离进程已停；0.2.5 隔离数据已还原；beta.3 隔离身份的配置目录、WebView2 目录和临时目录已删除（`cleanup.json`） |

## beta.3 真窗口（`run.mjs`，结果 `results.json`，截图 `shots/`）

| 步骤 | 操作与断言 | 结果 |
|---|---|---|
| boot | 启动隔离 exe，进入首页；`connected:` 证据；Run 项没有新增 | 通过（`01-boot-home.png`） |
| D6 | 打开底栏「快捷活动」弹层，内容没有「睡觉」 | 通过（`02-d6-quickacts.png`） |
| 自动化来源 | MCP 新协议 stdio（clientInfo `claude-ai` 0.14.2）`capture_todo` + `start_task_item`；旧协议无状态 HTTP `save_idea`；CLI `--agent 手环同步 time add`、`CLAUDECODE=1 idea add`、什么都不带 `idea add`、`context`；`pause_timer` 用过期 `expected_state` | 历史文件：MCP 记「Claude Desktop」（raw `claude-ai`）；旧协议 HTTP 记 `detected_by: none`；CLI 分别记「手环同步」（flag）、「Claude Code」（env）、未识别；被拒绝的 `pause_timer` 和只读 `context` 都没记。通过 |
| 小窗两段式完成 | 打开小窗 → 点「完成」→ 主窗口弹出完成对话框 → 点「完成」 | `card.complete` 来源 `{ kind: manual, via: mini }`；小窗命令本身没记。通过（`03`、`04`） |
| D4 | 小窗开着，主窗口连续重载两次（CDP `Page.reload`，等同 F5），每 0.5 秒取小窗文字 | 24 次取样都没有「主窗口未响应」；第二次重载后 0.5 秒内恢复。通过（`05`） |
| 快速记录条 | `show_quickbar` → 在记录条输入、按回车 | 主窗口补记 `quickbar.idea`（来源快速记录条）；记录文件带 `created_via: quickbar` 与 `history_logged_at`。通过 |
| D2 | 日视图，在整点线下 1px 按下、拖 1.2 分钟的像素、松手（真实鼠标事件经 WebView2） | 1× 05:54–05:55、2× 05:57–05:58 / 06:01–06:02、3× 04:58–04:59、4× 08:00–08:02，都是 1–2 分钟的新条目；在 1×、2×、4× 的 1 分钟短块中心点一下都打开弹窗、不新建（`drag-probes.log`、`06-d2-*.png`）。通过 |
| D3 | 新建一条后在弹窗里把时长改成 20:00、回车 | `entry.setDuration` 来源日历，时间 05:31–05:33 → 05:31–05:51。通过（`07`） |
| 列表 | 行内改描述、回车 | `entry.patch` 来源列表。通过 |
| 设置合并 | 外观里 0.6 秒内先后点两种强调色，再点回原色 | 合成一条 `merged: 2`，再改一次为 `merged: 3`。通过 |
| 操作历史页 | 列表 → 操作历史；仅自动化；调用方下拉；展开 CLI 那条；复制 ID；◎ 定位；960×600 | 下拉：全部 11 / Claude Desktop 4 / Claude Code 2 / 手环同步 1 / ─ / 未识别 4；详情含带 `--agent` 的命令；系统剪贴板与 `operation_id` 一致；◎ 切到日历日视图；960 宽 `scrollWidth = clientWidth`。通过（`10`–`14`） |
| 设置 09 | 「最近调用」；点第一条 | 跳到列表 · 仅自动化，展开 1 条。通过（`15`、`16`） |

实测中的说明：
- 第一版脚本拖动的位置算错（用了「现在线」往上两小时，落在已有条目上），有几次变成了移动已有条目（`entry.update`），不是新建；改成按整点线算坐标后，四个比例都是新建 1 分钟条目。这是脚本问题，不是产品缺陷，那几次 `entry.update` 留在了历史里。
- 历史里有一条 `review.enter`：测试中途打开过回顾页，进入回顾页时会恢复回顾进度，按设计会记。

## v0.2.5 兼容矩阵（`compat.mjs`，结果 `compat-results.json`，截图 `shots/compat-*.png`）

每个场景：beta.3 实测结束时的数据副本 →（用 beta.3 的真代码在指定路径注入断电，留下未完成 journal，`compat-craft.ts`）→ 真 0.2.5 打开 → 结果交回真 beta.3 打开。

| 场景 | 构造 | 0.2.5 | 回到 beta.3 | 结果 |
|---|---|---|---|---|
| 1 带 `history/` 的数据目录 | 29 条历史 | 正常进入首页，历史文件原样 | 正常打开，启动清理运行（`removed: 0`） | 通过 |
| 2 含历史新建文件的未完成 journal | 写到 `history/…` 时断电（`state.yaml` 已在计划里） | 恢复：journal 清空，补写那 1 个历史文件 | 正常打开，无残留 journal | 通过 |
| 3 设置历史改写（`before` 非空）且业务已部分写入 | 60 秒内标题字号改两次，第二次写历史改写时断电（`settings.yaml`、`state.yaml` 已写） | 恢复：`titleScale` 为 80，那条历史成为 `merged: 2`（65→80） | 正常打开 | 通过 |
| 4 改写带新字段的记录 | 一条带 `created_via`、还没吸收的待办 | `reconcile` 生成卡片并改写记录，`created_via` 保留；另一条带 `history_logged_at` 的记录保留该字段 | 吸收：写一条快速记录条历史、标记已写，卡片只有 1 张 | 通过 |
| 5a 吸收中断：写卡片时 | 待办 + 一次提交，写 `cards/…` 时断电 | 恢复整份计划：卡片、任务、记录标记、历史都写出 | 卡片 1 张、快速记录条历史 1 条 | 通过 |
| 5b 吸收中断：卡片已写、写记录时 | 写 `records/…` 时断电 | 同上 | 卡片 1 张、历史 1 条 | 通过 |
| 5c 吸收中断：卡片、记录已写、写历史时 | 写 `history/…` 时断电 | 同上 | 卡片 1 张、历史 1 条 | 通过 |
| 6 新版客户端连旧版桌面 | — | — | — | **未测**（需要另建 beta.2 隔离版本，用户决定这次不做） |

## 没测

- 系统来源（活动日切换、休眠恢复）：需要改时钟或 verify 构建，用户决定这次不测。
- 真实 AI 客户端（Claude Desktop、Cursor、Claude Code、Codex）的原始名字与环境变量：用户决定这次不测，对照表仍是公开资料里的值。
- 兼容矩阵 6。
- 回看（D7）的真窗口项、`recap-view.json` 的防抖与损坏恢复、D3 的输入法组合输入、D5 小窗切角放大截图、Windows 冒烟（`../架构设计.md` §8）。
- 真机性能数字（本次只看了功能）。

## 复现

```powershell
node evidence/beta3-isolated/setup.mjs --build     # 隔离身份、数据、构建
node evidence/beta3-isolated/run.mjs                # 真窗口各步（可只给步骤名）
node evidence/beta3-isolated/probe-drag.mjs 4x 08:00 --click   # D2 单个比例的分步实测
node evidence/beta3-isolated/compat.mjs             # 兼容矩阵 1–5
node evidence/beta3-isolated/cleanup.mjs            # 收尾与最终基线
```
