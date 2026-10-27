# M3 回顾与设置逻辑

2026-10-27。任务 `01a17c44-f7bd-7d03-ada3-229cd2055f78`。依据设计 v0.2 每周回顾与 A8、M1 回看范围合同、M2 想法与背包规则，以及本轮 lead 的明确授权。

## 行为与归属

- `domain/review/flow.ts`、`services/reviewService.ts`：主动/定期回顾、持久化步骤与已完成前缀、回看已完成步骤、入池、超额擂台、冷库捞回/跳过、继续押注、create/restore 换主线、完成。新想法使后续想法整理步骤重新待做；擂台没有额外轮数上限。
- 冷库满池先确认，再持久化待决配对；决定前不改双方想法，重启仍显示对决；跳过可取消。冷库与普通对决复用 ideaService 的 InTx，换主线复用 backpackService 的 InTx，与回顾进度同事务。
- 多条到期主线逐条决定，继续从原 `bet_ends_at` 加一个当前设置的押注期；最后一条处理后完成本期。换主线必须显式冷藏或放弃正在复盘的旧主线。背包页已移出该旧主线时，重新进入回顾认可该显式决定，避免停在空复盘页。
- 回顾计时从 enter 开始；普通刷新、页面离开/隐藏不结束；开始别卡或快捷活动由原计时服务切换。finish 只结束本回顾保存的 `timer_segment_id`，不会结束同名/同分类的用户活动。回顾没有任务卡，因此不计每日底线、不生成续卡。
- `services/reviewProjection.ts`、`store/reviewSlice.ts`：直接输出页面兼容的 ReviewData。回看自最近已完成回顾的 `completed_at` 到现在；被取代的未完成回顾不截断范围。首次从 first_used_day 日边界开始；旧已完成行没有完成时刻时不伪造截止点，保留更早内容。计时先按 seq 消除覆盖、裁剪范围，再用 timeline/stats 汇总；已完成卡与进度笔记使用实际时间筛选。
- 经 lead 同意，Card 新增可选 `progress_noted_at`，由 `tx.saveCard` 统一在已有卡进度文字改变时记录命令时刻。同事务重复保存保留已标记时间；旧已完成卡可用其已有 completed_at，旧未完成笔记不补造时间。这样再抽留下的进度也能进入回看。
- `services/settingsService.ts`、`platform/settings.ts`：单项与列表经同一串行事务写 settings.yaml；提交成功后更新 ctx.settings、store.settings、提醒与规则投影。快捷活动和休息列表可分别传 Partial lists，避免覆盖其他列表。平台失败按 SettingKey 返回，失败设置不落盘；journal 写失败显式抛出并阻止后续提交，恢复后重新同步平台。
- `ctx.onSettingsChange` 让 scheduler 在设置提交后重新安排日边界计时器，dispose 退订。没有增加轮询、任意超时或降级路径。
- Rust `set_shortcut` 按 quickbarHotkey/mainHotkey 注册；先申请新组合，成功后注销旧组合，冲突保留旧键。两个设置项不允许同一规范化组合。mainHotkey 唤回主窗口，quickbarHotkey 切换记录条。使用现有 autostart 插件启停自启。

## 接线合同

- `reviewService.enter(ctx,at)`：必须在实际进入回顾页时调用，不能用一般页面刷新代替；已完成当期再次 enter 不启动新计时。
- `goto(ctx,step,at)`、`addIdea(ctx,text,at)`、`duel(ctx,winnerId,loserId,at)`、`skipCold(ctx,at)`、`continueBet(ctx,at)`、`finish(ctx,at)`。
- `takeCold(ctx,ids,at,confirmed=false): Promise<ReviveResult>`；池满确认后传 true。返回 duel 时当前 step 仍 coldPick，`store.review.duel` 是待决配对，请冷库步骤显示 Arena。skipCold 取消待决配对且不改想法。
- `switchMain(ctx,draft:ProjectDraft | {restoreId:string;makeRoom:MakeRoom},at)`；create 与 restore 都由本服务原子保存主线和回顾进度。continueBet/switchMain 完成最后一条主线后自动完成回顾。
- `Snapshot` / `appStore` 新增 `review: ReviewData | null` 和 `settings: Settings`；ReviewData/ReviewStep 从 store/reviewSlice 引入可避免页面类型重复。
- `settingsService.change(ctx,key,value,at)` 返回 `{ok:true}` 或 `{ok:false,errors:Partial<Record<SettingKey,string>>}`；UI 应在失败时显示 errors，在成功时递增保存提示。
- `changeLists(ctx,lists:Partial<Settings['lists']>,at)` 返回 Promise<void>；列表非法或存储失败显式 reject。
- bootstrap 注入 `settingsPlatform: nativeSettingsPlatform`，并 `await applyPlatform(ctx)`；结果是按 key 的错误字典，应显示在对应设置行。Rust 启动已去掉硬编码默认键注册；lead 明确接受首次未选目录时快捷键不可用。
- `changeDataDirectory(port:{changeDataDirectory():Promise<void>})` 仅调用 app 提供的操作并传播错误，真实目录切换归 lead。
- 原 `shortcut_error` 命令为当前尚未接线 MainApp 保留；接入 applyPlatform 后可一起移除旧命令、旧调用及权限，避免保留空的错误查询。

## 验证与限制

- `npm run check` 通过：33 个文件、208 项测试，含 tsc、ESLint。日志 `evidence/m3-logic-check.txt`。覆盖 A8 到期边界/首次周/主动完成、恢复进度、计时所有结束路径、背包原子性、冷库重启、被取代范围、覆盖统计、未完成笔记、设置并发合并/失败保留/即时提醒和 scheduler 重排。
- `npm run tauri -- build --debug --no-bundle` 通过，普通 Windows 产物 `src-tauri/target/debug/pixel-record.exe`。日志 `evidence/m3-logic-build.txt`。保留既有第三方 PURE 与 chunk 大小提示，没有调整阈值。
- 未修改 src/app、pages、widgets、ui；没有操作实际桌面数据或 9223 端口。页面接线、真实快捷键冲突、系统重启自启、数据目录切换仍需 lead/原生验收确认，单元测试和构建不替代这些验收。
- 沿用测试进程 60 秒上限、产品规定冷库两个候选；没有新增任意输入/时间/轮次限制、静默回退或假成功。

建议提交说明：`feat: persist weekly review flow and apply settings immediately`。
