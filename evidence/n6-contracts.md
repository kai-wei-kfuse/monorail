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

## aab32f0 后续修复（2026-10-28）

本节覆盖上面尚待 UI 接线的历史状态：Claude 已提交独立 MiniApp、多页构建、主窗口接线与替换后的原生冒烟入口。

- mini capability 增加 `core:window:allow-set-size`、`core:window:allow-hide`，供现有 MiniApp 根据内容调高和关闭按钮隐藏使用。权限仍只匹配 mini，不增加数据目录或通用文件能力。
- 原生 mini 默认高度和最小高度均为 110；内容更高时由现有 ResizeObserver 调整。已有 mini-window.json 继续保留，系统最小高度仍生效。
- 已确认源码没有旧 windowMode 模块引用，删除 platform/windowMode.ts；MainApp 的同名 React 状态 setter 不属于旧模块。
- 首页卡项目、标签与覆盖标记已提供，详见 n3-contracts.md 新增小节。MiniSnapshot.card.project 仍保留原来 nullable 的「卡自身项目」含义，未悄悄改小窗编辑契约。
- `npm test`、`npm run check` 通过：57 个文件、379 条测试。新增五例覆盖项目继承优先级、同名显式覆盖、暂停编辑/清除覆盖/继续计时。
- 普通原生构建通过，dist/mini.html 存在并引用独立 mini JS，见 n6-followup-build.log；其他证据为 n6-followup-tests.log、n6-followup-check.log。
- 未实测真实窗口的缩放、关闭、跨窗口操作和提示外观；由 Claude 按此次交接安排完成真实程序 UI 冒烟。没有把开发预览或构建成功算作 Windows UI 通过。
- Claude 的 MiniApp 尺寸调整目前有空 catch，会吞掉原生失败；建议在 UI 线仅对明确的浏览器预览跳过原生调用，真实 Tauri 错误应显示或报告，避免下次权限问题被隐藏。本次未越界修改 app 文件。
- 融合布局仍保留在 0.2.0 范围，建议 Claude 在真实窗口验收和卡头接线后实现；本次没有修改阶段计划或新增列表设置。
- 提交建议：`fix(n6): allow mini window sizing and expose home card timing metadata`。未推送、未发版，原有 journal-real.json 改动保留。

## 42d9883 后续：小窗真实可见状态（2026-10-28）

问题是 MiniApp 默认关闭按钮直接调用 `getCurrentWindow().hide()`，不会经过 `toggle_mini`。仅在 toggle 的返回值后更新按钮文案，会漏掉小窗自身关闭或托盘操作。
本次在 Windows 原生 HWND 上监听显示/隐藏变化，保留现有 UI 调用方式。没有新增轮询、超时、第二套开关业务，也没有修改 UI/app。

```ts
// platform/miniWindow.ts
miniWindow.subscribeVisibility(handler: (visible: boolean) => void): Promise<() => void>
miniWindow.isVisible(): Promise<boolean>
// 原有 toggle(): Promise<boolean> / showMain(): Promise<void> 保持不变
```

Claude：主窗口挂载时调用 subscribeVisibility，回调接 UI 的 miniOpen 状态；卸载时调用返回的取消订阅函数，订阅失败走现有错误报告。按真实状态显示「开启小窗口 / 关闭小窗口」即可。toggle 的返回值不再用作持久 UI 状态；MiniApp 的直接 hide() 无需改写。

- 原生事件名 `mini-visibility`，发给 main，载荷 `{visible:boolean, revision:number}`。新增只读命令 `read_mini_visibility`，只授权 main；小窗未创建时返回 false。
- 监听器先注册事件，再查询初始状态。原生在同一窗口线程采样可见状态与 revision，JS 丢弃乱序的旧 revision，避免初始查询覆盖后来收到的状态。
- 使用 Win32 `WM_WINDOWPOSCHANGED` 的 show/hide 标志；用户的关闭按钮、主窗口开关、托盘开关、原生关闭/销毁均进入同一观察入口。没有用焦点变化猜测隐藏。
- `WM_NCDESTROY` 清理 subclass 和回调；销毁前 Windows 可能先发隐藏消息，按当前窗口的观察结果去重。监听安装失败会销毁尚未显示的小窗并显式报错。
- 代码位置：src-tauri/src/mini_visibility.rs（观察与只读查询）、mini_window.rs（首次显示前安装）、platform/miniWindow.ts（订阅与初始查询）、两处测试；原生清单新增只读命令权限，windows-sys 启用已有依赖的 Win32_UI_Shell 功能。
- 验证：npm test 58 个文件、383 条通过；原生单测 14 条通过，新增实际 HWND 的显示/隐藏/销毁、尺寸变化不误报、回调释放与安装失败清理。单测进程沿用项目 60 秒期限，编译单独执行。
- 完整 check 与普通原生构建证据：mini-visibility-check.log、mini-visibility-build.log；其余为 mini-visibility-tests.log、mini-visibility-rust-compile.log、mini-visibility-rust-tests.log。
- 未实测此次主窗口文案联动：Claude 尚需接上订阅并恢复状态文案；本次真实 HWND 底层测试不等于完整 Tauri UI 端到端验收。
- 提交建议：`fix(n6): publish native mini window visibility changes`。不推送、不发版。
