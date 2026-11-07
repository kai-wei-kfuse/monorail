# ADR 0025：背包开始计时时复用旧抽卡擦除

状态：Accepted（v1.1，仅技术决定；GUI待用户确认） · 2026-11-07 · 对应 [0.3.2](../stages/0.3.2.md) 第5条。页面交接流程的中等变更；GUI待用户看图确认，未实现。

## 问题与选择

0.3.1把抽卡移到今日任务板，FlipDeal负责翻卡预览；旧HomePage仍有Wipe/frozen状态，却没有setWipe调用方。用户要求把旧擦除移植到背包抽卡之后的开始计时，不取消翻卡。

选择在BagScreen统一一个 `startFromBag(cardId, at)` 组装回调，供翻卡后〔开始〕、任务抽屉/详情〔开始〕和今日板行〔开始〕共用。动画属于main GUI，不进homeService、MCP或CLI。保留唯一startCard事务，计时从点击at开始，不等待动画覆盖或结束。首页自身开始、计时输入选卡、小窗/API开始不自动套此演出，避免无指示的跨入口扩张。

## 流程与不变量

1. 点击捕获at与目标cardId，沿用原有串行服务校验；连续点击同一次开始在UI处于进行中时不重复发起，不添加超时或自动重试。
2. 在发送开始请求前捕获旧卡展示数据，但不画“成功开始”动画。保留抽屉/翻卡上下文直到事务结果明确；失败显示原错误、保留可重试界面，不关闭后假装成功。
3. 成功开始后关闭抽屉/翻卡、回首页，由MainApp传一次性呈现请求 `{id,cardId,at,previousView}` 到HomePage。仅当当前提交投影仍是这张卡在计时、且不是pending/插入时消费请求，避免排队期间另一入口已换事却播旧卡。
4. HomePage复用Wipe组件和原有frozen机制：完整动效先保持旧展示，色块盖满后解除frozen，底下露出已经提交的新卡；退出后调用playAfterWipe。没有旧卡时用空白原卡区，不伪造旧任务。不另写一套擦除引擎。
5. 旧的HomePage孤立wipe/frozen状态迁移到这个可达流程，移除废弃“再抽一张”的触发注释/默认文案分支；不要在BagScreen另画一份Wipe。来源不同共用这个回调。

事务结果需要能区分提交前失败与提交后projection/notification失败：后者不重复startCard、不宣称失败后未计时。先显示现有明确“数据已提交，后续处理失败”信息；投影不可用就不播动画。复用ADR0024 v1.2的PostCommitError结构化committed/warnings/result，不解析中文错误字符串；transact失败/journal阻塞保留界面但禁重试直到按现有流程恢复。

Wipe `onCovered/onDone` 只控制展示；卸载清理、切页、关闭窗、减少动效、另一计时动作打断均只结束演出，绝不二次调用startCard、停止计时或回滚已成功事务。回调带呈现请求id，旧回调不能清除新请求。当前动画期间原卡区开始/编辑动作暂不响应（沿用UI规范§8.3），不加全局业务写锁；外部新投影改变目标时立刻结束旧演出。

补充冻结边界（S7）：`FrozenStage = {kind:'card',view:TaskCardView} | {kind:'blank'} | null`，不能继续用 `frozen ?? live` 把“冻结空白”解释为新卡。onCovered前，card分支显示旧卡且FusedCard的card元数据和view同源；blank分支在空CardFrame挂同一Wipe。Wipe呈现层在两种分支均可达，不依赖新task存在才挂载。onCovered后统一清冻结露出已提交的新卡。

补充错误处理（S6）：开始捕获isPostCommitError时先报告、关闭翻卡/抽屉防止再次提交；projectionFailed为true时不播擦除。普通提交前失败保留原上下文，journal阻塞时禁止重试。结构化字段及守卫按ADR0024，不另造第二结果契约。

## 视觉规格

- 完整：沿用§8.3的强调色色块，300ms从左盖满、停420ms、320ms向右退出；旧有数字/元数据入场与新标题升起、竖条回弹不另调参数。范围是首页卡区，保留标题栏/底栏。
- 文案改为 `START TASK / 开始计时`，大号为实际主/支线格号（无格号用“—”），侧边显示轨道、项目、卡类型与标题；不是“再抽一张”或“开始专注”。当前用户明确恢复的是旧擦除，不恢复§8.7删掉的斜带开始专注横幅。
- 简化：保留现有FlipDeal简化流程，开始成功后220ms淡入新卡，不出现大色块。关闭：保留原先不翻卡直接开始路径，不额外演出。翻卡本身的完整/简化/关闭行为不改。
- 参数来自现有Wipe/intro，不新增设置项。成功后演出期间读数继续显示以点击时刻为基准的真实值。

简化实现补充（S8）：`intro.ts/playAfterWipe` 明确按level分支，reduced调用 `fadeIn(card,220)` 后return，off直接return，full仍用revealLines/popBars。不能指望现有play在reduced执行，它当前会跳过动画。

## 验证

- 原型在 `../../../原型/页面/explicit-insert-prototype.html` 右侧“背包开始计时”区，三种入口和三种动效等级可选择；截图与自检见 `../../evidence/0.3.2-insert-prototype-report.md`。样例模型不等于生产业务验证。
- 实现后：三入口同一回调、off直接开始；抽卡预览/换一张不开始；提交前失败不关闭上下文/不播；重复点击只调一次服务；点击at不被动画推迟；提交后失败不重试；切页/隐藏/卸载/另一投影打断不改计时；960窗口与动效降级。
- UI使用gallery真service后再做隔离原生最小冒烟。不修改FlipDeal抽样与抽卡权重，不为动画新增MCP方法或历史业务动作。

## Revision History

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-11-07 | 对应新增第5条：统一背包开始呈现请求，复用Wipe，不改变计时提交时刻和翻卡行为；待GUI确认 |
| v1.1 | 2026-11-07 | 吸收自动化侧S6–S8：共享结构化提交后错误、冻结空白/卡判别联合与FusedCard挂载边界、简化220ms显式fadeIn |

技术审核依据：需求侧 `evidence/0.3.2-plan-review-insert.md`、技术侧 `evidence/0.3.2-plan-review-insert-automation.md` 定向复核；S6–S8已明写入方案。接受技术决定不代表用户GUI已确认或代码已实现。
