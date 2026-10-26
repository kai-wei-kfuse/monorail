# 架构验证·第 3 关：技术骨架

2026-10-27。工程在 `app/`，已初始化独立 Git 仓库；仅本地提交，不 push。实施起点是架构 v1.0，交付对照已更新的 **v1.1**。这是最小验证骨架，不能据此宣称完整产品或所有架构路径已经通过。

## 九项验证结果

| 项 | 结论 | 怎么测、结果与证据 |
|---|---|---|
| 1. 隐藏主窗口时记录条保存、转卡、提醒计划、幂等 | **通过（程序内真实 API）** | verify 构建使 mainVisible=false，由真实 quickbar WebView 调用与保存按钮相同的 persistRecord→原生命令，主窗口收到 data-changed 后自动 reconcile:1；重复事件与 reconcile 均为 0，只有一张对应卡，期限计划已同步。见 `app/evidence/native-verification.jsonl` 的 verification-hidden-record-passed、quickbar-saved、reminder-plan。实际点击保存按钮路径未测。 |
| 2. 隐藏至少 10 分钟与通知 | **部分验证** | 2026-10-26 23:58:59.855 开始，2026-10-27 00:09:26.536 唤回，计算时长 **626,681 ms（10 分 26.681 秒）**，同一 started_at 和未结束段保持不变；通知 API 在计划时间后 **84 ms** 返回成功。时长与原生定时投递通过；**屏幕 Toast 可见性未核验，未运行满 30 分钟**。见 native-verification.jsonl 的 verification-background-passed 与 notification-dispatched。 |
| 3. 休眠/唤醒、崩溃恢复 | **部分验证** | 模拟电源事件通过同一个原生记录函数，明确带 simulated=true，配对 suspended_at/resumed_at 正确。真实杀进程后重启，previous_last_alive 精确保留旧值，界面显示由旧值至 startup_at 的离线追问。**未实测真实休眠**，避免中断用户其他任务；强杀仅模拟进程崩溃，不等价硬断电。见 `native-conflict-and-recovery.json`、`lifecycle-final.json` 及 native-verification.jsonl 的 verification-power-simulated-passed。 |
| 4. 目录授权跨进程重启 | **通过** | 首次实际使用原生 dialog 选目录；随后多次真正杀进程再启动，均未再次选择目录，Tauri fs 能读实体、重写 state、恢复 journal。见 native-verification.jsonl 中首次 connected、后续启动 connected/cards=1 及 journal-recovered:1；最后一次使用普通非 verify 构建。 |
| 5. journal 中途失败、杀进程、启动重放 | **通过** | 真实 Tauri fs 多文件提交中，第一份文件成功后，在第二份写入前注入异常；确认 journal 存在且第二份文件缺失，再杀掉进程。普通构建启动重放 1 条 journal，两文件 token 一致，日志目录清空。见 `journal-before-process-kill.json`、`journal-after-process-restart.json`（passed=true）。另有 memoryFs 和真实 Node 文件系统恢复用例。 |
| 6. 并发 start/complete 与 seq | **通过（自动化用例）** | 连续并发提交 20 组 start/complete（40 个动作），全部完成，40 个逻辑段 seq 唯一，有效区间不重叠。跨日回归另验证拆分保留逻辑 id/seq，不覆盖更早补记。见 `app/evidence/check.txt`、`src/services/commit.test.ts`。这不是实际快速点击 40 次。 |
| 7. 小窗切换及恢复 | **通过（真实窗口 API）** | 真实主窗口缩成 520×88 逻辑像素并置顶，恢复原尺寸、位置、置顶状态；另验证最大化→小窗→还原后仍最大化。见 native-verification.jsonl 的 verification-window-passed（含前后尺寸和位置）。未逐个点击小窗按钮验收视觉。 |
| 8. 自启开关 | **通过（真实插件 API）** | isEnabled 初值 false，enable 后 true，disable 后 false，并恢复原值。见 verification-autostart-passed。**没有重启 Windows，开机实际启动未测**。 |
| 9. check 与反向 import | **通过** | 最终 tsc、eslint、Vitest **12 项测试**全部通过，测试进程有 60 秒硬上限；故意从 shared 引 app/bootstrap，lint 返回 import/no-restricted-paths 错误，然后已删除探针。见 `check.txt`、`lint-negative.txt`。生产和 verify 构建都成功，npm audit 为 0 漏洞。 |

## 真实触发路径与 API 验证的区别

真实操作另测到：原生目录选择、主窗口前台时实按 Ctrl+Alt+Shift+R 唤出记录条、点击主窗口完成任务导致记录条失焦隐藏、点击标题栏关闭后窗口隐藏而进程仍在。证据为 `app/evidence/user-paths.md` 与 `completed-card.md`。**实际点托盘图标唤回、其他应用前台时的全局快捷键、真实记录条保存按钮、Toast 外观与真实休眠仍未覆盖。** 窗口控制工具对 owned dialog 的索引/焦点不稳定，首次目录选择最终通过另一原生控制接口完成，没有绕过输入保护。

## 修复与发现

1. **快捷键冲突不应阻止应用启动。** 实测 Ctrl+Alt+R 已被占用，最初导致启动失败；已改为显示明确错误但保留应用运行，原绑定不自动更换。验证默认组合为 Ctrl+Alt+Shift+R，可由进程环境变量显式覆盖。修复后用已冲突的 Ctrl+Alt+R 再启动，应用存活且界面显示错误。见 `native-stderr.txt`、`native-conflict-and-recovery.json`。
2. **quickbar 写权限采用窄原生命令。** dialog 动态目录授权不能单独保证 quickbar 仅写 records；因此只开放 save_quick_record，新建固定 records/<uuid>.md、不覆盖，业务转换仍由 TS 执行。已反映在 v1.1。**附件复制与“先附件后记录”尚未实现/实测**，当前附件为空数组。
3. **跨日覆盖优先级已修复。** 物理切片沿用同一逻辑 id/seq，切片必须互不重叠；不同逻辑段不能复用 seq。03:30–04:30 学习、先补记 03:50–04:10 厕所、再关闭原计时，最终学习仍为 40 分钟、厕所 20 分钟。符合更新后的 A1/闭环表第 40 条。不能再用“所有物理行的 seq 都不同”当验收标准。
4. **验证入口隔离。** `src/verification/` 只在 Vite verify mode 引入；原生模拟电源与验证触发由 Cargo verify feature 隔离。最终交付 exe 是**普通非 verify 构建**，生产前端扫描无验证入口。见 `production-isolation.txt`、`production-build.txt`、`production-executable.json`。新增验证目录与配置经接手负责人同意。
5. **提交错误处理。** 拒绝一个尚未写入的无效命令不会锁死后续队列；只有 journal 写入失败才要求重启恢复，避免在部分提交后继续写。该行为有回归用例。

## 尚未实现或应继续处理

- 按负责人允许，v1.1 **第 46、47 条后续**暂未做：仓库组装仍在 createContext，尚未移到 data/repos + bootstrap；每次提交仍全量读取计时文件，正式开发前需改为按日期读取。
- 当前只覆盖 start/complete、插入/返回、reconcile 及核心计时存储；完整选卡、缩小/降级/回顾、时间盒确认、设置编辑、附件和视觉均不在本次骨架完成范围。事务重入诊断及全部 InTx 接口约定也未完整实现。
- v1.1 新增的“离线超过阈值先自动落账，再让用户修改”**未实现**；本次只证明 native last_alive 保存、旧值保留和离线区间可恢复。每分钟心跳使崩溃时点有最多约一分钟的不确定性，不能视为精确断电时间。
- 提醒投递去重目前只在进程内；实测重启会重新投递尚未完成的过期期限计划。正式提醒模块需要持久化送达状态及相应回归。
- journal 已验证应用异常/强杀恢复，但没有真实断电测试；当前不宣称完整断电耐久性。
- 构建保留了第三方 PURE 注释和较大 bundle 的警告，没有为清除告警而修改业务或调高限制。

## 运行与交付

- 源码与独立 Git：`C:\Users\kai_wei\Documents\1026(4)\app`。
- 普通可执行文件：`app/src-tauri/target/debug/task-terminal-skeleton.exe`，嵌入构建后的前端，不依赖 Vite 开发服务器；**没有安装 MSI/NSIS 包**。
- 精确 npm 版本与 package-lock.json、Cargo.lock 已保存；使用本机已有 Rust 1.95.0/MSVC，无新增工具链安装，不改全局 Rust 默认。
- 重现命令见 `app/README.md`；验证运行时使用 computer-use 技能及原生窗口接口，最终数据留在 `.verification-data/desktop`，不提交测试数据。
- 测试过程中没有修改项目根目录的其他设计文档。本报告的副本保存在 `app/evidence/verification-summary.md` 随本地提交保存。

本轮证据支持核心技术路径可以继续开发，不能等同于“v1.1 所有规则已经实现并验证”。
