# 0.3.1 隔离真窗口测试（第一批：G6b 宽松 / 紧凑模式、G8 改计时记录）

2026-11-06 · 证据类型：**真窗口**（隔离身份的 debug exe，WebView2 调试端口驱动）。只测已经有界面或接口的部分；G7 的插入卡、背包抽屉、翻卡、拆分对话框、带过去的确认还没做，**未测**。

## 环境与隔离

| 项 | 值 |
|---|---|
| 代码 | `1312214`（G7 宽松显示）之上，工作区没有未提交的代码改动 |
| 隔离身份 | `local.pixelrecord.v031test.t<12 位随机>`，productName `单轨0.3.1隔离测试`；数据 `%TEMP%\monorail-v031-<随机>\data`；只给这个目录 fs 权限 |
| 构建 | `npm run build` 后 `tauri build --debug --no-bundle --config <隔离配置>`（`setup.mjs --build`），复制为 `Monorail-0.3.1-isolated.exe`；没有打包、没有安装 |
| 首次启动前 | 数据目录预置 v1 `settings.yaml`（关开机自启、隔离快捷键），由 v1 → v2 迁移建数据 |
| CLI | 本仓库 `dist-cli/monorail-cli.mjs`，经 `MONORAIL_PIPE` / `MONORAIL_CONFIG_DIR` / `MONORAIL_EXECUTABLE` 指向隔离管道；调用方「Claude Code」用 `CLAUDECODE=1` 模拟 |
| 日常版 | 全程运行（PID 46120），只读不写。前后 Run 启动项、日常 exe 与 `config.json` 的 SHA-256、PID 都相同（`baseline-before.json`、`baseline-after.json`） |

## 结果（`results.json`、截图 `shots/`）

| 步骤 | 操作与断言 | 结果 |
|---|---|---|
| boot | 启动、迁移、补「学习」「工作」两个项目再启动，进首页；没有新增 Run 项；四个新设置键（taskMode、trackingMode、insertBackPlace、idleAskMinutes）缺省时按默认值读，保存后写进文件 | 通过（`01`） |
| strictIdle | 紧凑模式（默认）首页：标题栏「待机 00:10」、强调色灯；计时条 IDLE | 通过（`02`） |
| looseIdle | 设置 04 点〔宽松〕：文件 `trackingMode: loose`；「空闲多久后追问」隐藏，「离线追问最小间隔」仍显示。首页：标题栏「没在计时 --:--」、灰灯；计时条 OFF、「没在计时」、读数 00:00，隔 2.2 秒不变；下面一行「没在计时。写下在做什么，或者点〔开始〕」。日历没有〔显示待机〕开关；回看开关是「含睡眠」 | 通过（`03`–`06`） |
| backToStrict | 切回〔紧凑〕：标题栏回到「待机」、强调色灯，文件 `trackingMode: strict` | 通过 |
| updateEntry | `--help --json` 有 `rules`；`entry delete` 退出码 2，`next_step` 带「不要直接改单轨数据目录里的文件」。CLI `time add` 补一段，再 `entry edit` 改结束、描述、标签，结果对得上；开着的待机改描述报 `ENTRY_IS_IDLE`（退出码 3）；列表页显示改过的记录；历史 `auto.update_time_entry`，来源「CLI · Claude Code」 | 通过（`07`） |
| listCheck | 重启后列表仍显示改过的记录，历史主体是这条记录 | 通过（`07b`） |
| taskMode | 首页没有〔再抽一张〕；设置 02 是「任务模式」，文件 `taskMode: true` | 通过（`08`） |
| finish | 停进程，比对基线 | Run 项、日常 exe、日常 `config.json`、日常 PID 都没变 |

第 1、2 轮 `updateEntry` / `listCheck` 失败是脚本问题：列表的描述是输入框，文字在 `value` 里，`innerText` 读不到；改成连同输入框的值一起读后通过（`run3.log`）。第 4 轮失败是历史条数按「总数等于 1」断言，前几轮已经写过；改成按本轮新增计（`run5.log`）。应用本身没有改动。

## 没测

- G7 的全部界面（插入卡、背包抽屉、翻卡、拆分对话框、带过去的确认、小窗插入状态、任务模式关掉时的界面）：还没做。
- 宽松模式下关机或休眠后不追问、紧凑模式空闲超过阈值后的追问通知：要等真实的离线或空闲时长，**未测**（有单测）。
- 宽松模式的小窗：**未测**（只有无头截图 `../../../.tmp-shot/g7-confirm/04`，仓库外）。
- 0.3.0 隔离往返、真实 AI 客户端：在 G9 做。

## 复现

```powershell
npm run build
node evidence/0.3.1-isolated/setup.mjs --build
node evidence/0.3.1-isolated/run.mjs            # 可只给步骤名：boot strictIdle looseIdle backToStrict updateEntry listCheck taskMode finish
node evidence/0.3.1-isolated/cleanup.mjs        # 删隔离身份的配置目录、WebView2 目录和临时目录
```
