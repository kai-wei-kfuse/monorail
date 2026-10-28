# N6 小窗逻辑线契约与简报

2026-10-28。逻辑线、原生窗口和权限已实现；UI/app 接线待 Claude，尚未完成 Windows 双窗验收。

## Claude 可立即接的入口

- 新建独立 `mini.html` 与 MiniApp 入口，Vite 多页构建包含它。原生 mini 窗口 URL 固定 mini.html，懒创建，初始隐藏/置顶/无边框/不在任务栏。**不能在小窗入口调用 bootstrap 或创建 Ctx**。
- 主窗口 bootstrap 得到 ctx 后：`connectMini(ctx, mainWindowBus, effects, MINI_HEARTBEAT_MS)`（services/miniController.ts + platform/windowBus.ts）。返回卸载函数。effects 包括 openMain()、complete(cardId, at)、report(error)。openMain 可注入 miniWindow.showMain；complete 应打开主窗口完成表单，保留传来的点击时刻。
- 底栏、M 快捷键调用 `miniWindow.toggle(): Promise<boolean>`（platform/miniWindow.ts），返回是否显示。托盘已接原生开关。删除 MainApp 旧 mini 分支和 windowMode 导入后，逻辑线删除 windowMode.ts；verification/main.ts 旧 setMini 验证也需改。
- 小窗先注册 `miniWindowBus.onSnapshot` / onReply，再 `ready()`。每次发布与每秒心跳收到 MiniSnapshot。UI 只接投影、发命令，不读写数据目录。
- `miniUnresponsive(lastReceivedAt, mountedAt, now)` 在超过 3000ms 无快照时返回 true；此时显示「主窗口未响应」。心跳不增加 revision。

## 协议

类型唯一来源 platform/windowBus.ts。MiniSnapshot 含 revision、entryId、cardId、pending_id、entry/pending/resumeDescription、卡内容/状态/项目/标签/目标分钟、closedEffectiveMs/currentSegStartedAt、awayActivity、projects/knownTags/accent。

所有 MiniCommand 带 `{requestId, at, entryId, cardId}`。requestId 用于匹配回复；entryId/cardId 来自编辑打开时的快照。

- pause/resume/openMain：上述基础字段。
- complete：cardId 非空；主窗口事务核对后返回 `{kind:'complete',cardId,at}`，打开主窗口完成表单，尚未直接完成卡。
- beginPending：另带 pending_id:null。
- cancelPending：另带 pending_id:string。
- editOpen：另带 revision、pending_id、patch:{description?,project?,tags?}。待机/待确认时确认输入会开始自由条目；已有自由条目则编辑它。
- editCard：另带 revision、非空 cardId、content、project?、tags?；暂停时可编辑卡，继续会按新模板开始。
- setReadout：另带 revision、pending_id、target:{mode:'pending'|'entry'|'ref',id}、milliseconds、seen:null或完整 plan。

主窗口传输边界先 zod 校验形状，homeService.dispatchMiniCommand 在队列内核对目标/版本/会话，再调用与主窗口相同的 InTx 动作。错误回复 `{kind:'error',message}` 并推送新快照。
读数需要确认时回复 `{kind:'confirm',plan,hit}`。确认沿用原 at、target、milliseconds、seen=plan，但 revision 取最新快照（预览后事务也发布一次）。编辑对象已改变时不要改成新的 id，等待服务拒绝。

## 当前交接边界

只实现逻辑线，不修改 app/pages/ui/widgets。mini.html、MiniApp、接线、旧缩窗 UI 删除由 Claude 负责。未提供 mini.html 前不要把托盘新菜单称为可用功能；其 URL 不会误加载主入口建立第二个写入方。
原生 mini 权限只有事件收发和拖动；主窗口持有 toggle_mini/show_main 命令权限。mini-window.json 存在应用配置目录，仅 Rust 读写位置和尺寸。

## 原生与协议检查

- Windows WebView2 要求在 UI 线程外创建窗口：toggle_mini 使用 async + spawn_blocking，托盘异步派发；锁覆盖首次创建和切换，避免两入口同时建同名窗口。
- miniWindowBus.onSnapshot 丢弃低于已接收 revision 的迟到快照；同 revision 心跳照收。它不计时间，只向 UI 回调，UI 自己更新 lastReceivedAt。
- beginPending 按计划只核对当前没有 pending；已有 pending 时来自旧快照的 begin 被拒绝。cancelPending 与 pending 读数核对不变的 pending_id。
- 已知未验证场景：拔掉外接显示器后的旧位置可能落到屏幕外，当前不自动改写坐标。尚未实测显示器切换；用户可关闭应用后移走配置目录的 mini-window.json 重置位置。

## N6 简报

- 已做：快照/命令唯一类型、zod 传输校验、事务内目标/revision/pending_id 核对、共享首页 InTx、快照订阅、心跳、低版本快照拒收、错误回复、完成动作转交主窗口表单、独立懒创建原生小窗、托盘开关、位置/尺寸保存、最小权限。
- `npm run check` 最终通过：57 个文件、374 条测试（含 Claude 同期提交的测试），见 n6-check.log；npm run build 通过。Rust 单测 12 条通过（整个单测进程有 60 秒期限，编译另行执行）。`npm run tauri -- build --debug --no-bundle` 成功，产物为 src-tauri/target/debug/pixel-record.exe；该原生构建早于最后一次纯前端错误回复补充，最终前端代码已单独重做 check/build。
- 证据：n6-check.log、n6-rust-build-tests.log、n6-rust-tests.log、n6-native-build.log。n6-tests.log 是较早一轮 371 条测试的中间记录，最终以 n6-check.log 为准。
- 只读代理审查了协议与原生边界；原生同步创建风险按 Tauri 本地源码的 Windows 限制改成后台线程，并重新编译/单测。
- **未做/未测**：mini.html 与 MiniApp 接线、MainApp 旧缩窗 UI 移除、windowMode.ts 删除、verification/main.ts 旧缩窗冒烟替换；这些需要 Claude 先改引用。真实双窗并存、主窗口隐藏后小窗操作、位置跨重启恢复、三秒提示实际可见、覆盖确认外观均未实测。构建通过不代表这些冒烟通过。
- Claude 完成接线后，先删除旧 windowMode 的两个引用，再删除文件；接上新小窗冒烟后用户实测上述 Windows 场景。逻辑线没有修改 UI/app 或验证入口。
- 未推送/未发版。下一次发布应包含 cbe1b11。
