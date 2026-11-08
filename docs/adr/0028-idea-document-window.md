# ADR 0028：独立想法笔记窗口

状态：Accepted v0.3 · 2026-11-08。唯一维护方：coder-6。用户已确认0.3.3原型（`01M6WQPHN8EDD2JA3ZSM57YDWN` / `01M6WQPHQKEA5KZ7298QE2CJ2N`），coder最终审核通过。大窗、快速记录条详情草稿开窗、贴边直角与D1/草稿协议按已审基线实施。内容契约以[ADR0026](0026-record-title-and-markdown-details.md)为准，外部方法同版交付见[ADR0029](0029-v033-automation-parity.md)。

审核：[0.3.3-final-plan-review-coder.md](../../evidence/0.3.3-final-plan-review-coder.md)；Runner `01M6WSEHW6ZX6YECSPYQEFV4CJ`。同一v0.3基线仅更新接受状态与引用，不代表原生实现验收。

## 问题与决定

现有 mini/quickbar 是置顶条形窗。mini 只有计时命令；quickbar 仅create_new新记录，不能编辑已有笔记。不能复用它们承担文档编辑或给新窗口一套文件写入。

推荐每个想法record_id一个独立、可缩放的普通文档窗：同ID再开聚焦现有窗；不同ID可以分别开窗，不加全局只能一篇或任意窗口数量上限。窗口可最大化、在任务栏显示，默认不置顶；默认尺寸沿主窗1000×720，实际不超当前屏幕工作区，不限制正文长度。窗口只持有本地草稿；main仍为业务写入者。

## 打开与草稿规则（v0.3，原型已确认）

1. 已有笔记的“新窗口打开”按钮只在想法详情页阅读/编辑处，列表不加此入口（用户局部反馈经coder-3转达，`01M6WNQG2MCYH8VJGBR7ZKA9FE`）。阅读态打开已提交记录，原页面上下文保留；大窗默认阅读，可进入编辑。窗口名为“单轨 · 想法笔记”，不在产品界面写“独立大窗口”。快速记录条展开“写详情”后的草稿入口按下一节处理。
2. 从有未保存内容的编辑态打开，携带原草稿及其base record_revision，进入大窗编辑；原视图草稿保留。不能为了打开先静默保存，也不能丢掉草稿或把base换成最新后覆盖别人。
3. 同ID已有dirty窗：只聚焦，不重载、不用源视图草稿替换它。已有clean窗可重载当前已提交版本；如源视图携带草稿，保持其base修订并显示冲突（若已不匹配）。
4. 同记录提交成功后，clean视图接受新内容；dirty视图保留草稿并提示有新版本。只有发起保存、request_id和草稿版本匹配的视图可据reply清dirty；其他dirty视图不因广播或source=note-window自动清除，可由用户明确采用已保存版本。
5. 标题/详情编辑与预览切换不影响dirty。关闭dirty窗提供保存/放弃/取消；保存失败/冲突/结果未知不关闭、不清空。关闭窗口不删除记录。
6. 记录被删除或主数据会话改变时，保留现有草稿、拒绝旧保存，给明确状态；不自动重建记录或把草稿写到另一个数据目录。

编辑态复制草稿会留下两份本地编辑分支，沿已确认原型保留，不等于两份已提交记录。大窗保存后原抽屉若仍dirty，保留并展示新版本，不能自动清原稿、静默保存或转移后假称原稿已存。允许用户明确采用已保存版本；不以全局“只能编辑一处”避免冲突。

### 独立窗外观（v0.3）

用户已确认：去掉外层多余标题栏、窗口壳与外边距，编辑框贴边铺满且全部直角。原型styles.css:1499–1521移除演示/外层标题并将客户区padding=0、内容占满视口。正式IdeaWindowApp不套MainApp标题栏/底栏与常规页面边距；仅保留笔记自身标题、模式与保存/关闭等必要操作，正文使用剩余客户区并内部滚动。外层无圆角、阴影或浮动卡壳，不能以固定像素高裁掉长文。普通原生窗仍可移动、缩放/最大化/关闭；系统必要控件或最小拖动接线不形成第二条产品标题栏。已有记录入口仅详情页；QuickBar入口仅想法“写详情”展开区，列表和待办不加开窗按钮。

## 快速记录条草稿开窗（v0.2，QW1/QW2）

仅想法“写详情”展开区提供“去独立窗口编辑”。打开前不保存半成品，窗口直接带标题/详情/needs草稿进入编辑。未保存对象没有 record_id/record_revision，不得用固定 `qb-draft` 假装已存记录；给当前想法草稿生成独立 UUID `draft_id`、单调 `draft_version`，另分配一个持久写请求用的 `create_operation_id`。draft_id、operation_id与已保存record_id职责不同，不按标题或当前记录正文推断身份。

移交带 draft_id、draft_version、所有实际字段的快照、main_epoch及来源窗口。打开失败不登记active窗口、不清原稿；同草稿已有窗口只聚焦，dirty不被新快照覆盖。保留原记录条草稿及其版本，类型切换不重置这些字段。已交接后来源registry同时绑定真实quickbar与文档窗，消息不能自报一个draft前缀就取得保存权。

**路由由同一个草稿状态决定，不由保存按钮决定：**

| 状态 | 保存/开窗规则 | 成功后的去向 |
|---|---|---|
| local | 普通未交接草稿仍走既有quick_save/create_new。开始保存前固定本次record_id与完整请求快照；开窗请求先进入交接状态，随后所有该草稿保存走main | 开始保存→saving；完成交接→handoff |
| saving | 既已接纳的quick save继续完成，开窗等这次确定结果；期间不另发create_idea。不以未收到data-changed推断未写 | 成功取得真实record_id并由main吸收后打开该记录；明确未执行才允许交接；结果未知保持saving并对账 |
| handoff | 未创建；原条和文档窗的首次保存均走main同一create_idea/提交队列，不再绕回create_new。首个实际保存把规范请求绑定create_operation_id | 已接纳→create_pending |
| create_pending | 持有首个规范请求，不把后来编辑塞进它；相同ID/请求先查回执/重放，不同请求明确冲突并保留草稿。不发另一个ID掩盖未知结果 | 持久committed回执→committed；仅确定not_executed且未形成持久回执时按现有协议重试/修正，已有回执则先按其规范输入比较；未知保持本状态 |
| committed | 原条和大窗绑定同一真实record_id；原create重试仍返回原回执，后续内容保存走update_idea与record_revision，不能再建旧想法 | 清稿后原条下一次新记录使用新draft_id；保留dirty分支则仍为此记录的待处理编辑 |

这里的交接/请求状态是每份草稿的编辑状态，不是另一把业务写锁。用既有main队列与quick_save准入排清先前保存；交接开始立即改变原条保存路由，握手未完成时留存等待，不允许返回local偷走旁路。弹窗失败可重试开窗，不撤销已接纳/已提交的写入。普通未交接快存与待办快存不为该功能改成依赖主窗。

第一位提交者可能是原条，也可能是文档窗。未提交时两处内容不同不合并、不抢最后写；第一份已接纳请求确定create_operation_id的规范输入，另一份异内容请求显示OPERATION_CONFLICT/已创建记录并保稿。需要修改已创建内容时由用户核对后明确转为update_idea，取得并使用该记录基线；不能自动把旧草稿base换成最新修订覆盖。若创建时文档窗继续输入，只更新发送快照的已存基线，后来输入保持dirty。

QW1原条清稿必须同时吻合**被交接的draft_id、draft_version、完整移交快照**，才可重置该想法草稿；若原条后来继续输入或换新草稿，原样保留。完成通知仍记录此次创建的record_id，避免其下一次保存意外再create；dirty分支与已创建内容不一致时提示核对，不静默把两份合并。清稿不影响待办草稿。

QW2正式幂等来自main既有持久receipt/journal，不来自内存draft→record map。相同操作重放按**原规范请求/原回执**判断，不能按当前记录正文比较：记录后来被编辑/完成/删除，原create重试也不重建；不同请求同操作ID拒绝。创建成功后重绑record_id不能令一条晚到的原create请求变成普通update。主窗重载旧epoch的写拒绝，但允许经合法只读查询核对原operation_id结果，草稿不自动换epoch。

普通quick_save目前无持久回执。交接与它相邻时至少保留本次预分配record_id、实际规范写快照和saving结果；main经既有只读/吸收路径核对真实文件及原生保存是否已结束。没有文件而保存仍在途不是not_executed；文件存在但不匹配原快照是明确冲突/待人工核对，不猜成功。不把data-changed事件或内存map当跨进程提交证据。若进程异常后无法恢复这份原身份，不宣称可安全自动重建或已保存；跨崩溃未保存草稿恢复不是本条新增承诺。

正式接口中的create_idea仍用ADR0026的operation_id，不为窗口内部draft_id增加第二套公开领域方法。附件仍按现有“先附件后记录”顺序；交接快照须包含实际附件身份与已完成保存路径，不能因原型未放附件控件就在正式开窗时丢掉它们。具体平台附件保存与窄桥接线在P4复核，笔记窗不获fs权限。

## 原生与消息协议

新增独立入口 idea.html/IdeaWindowApp，Vite构建登记。原生标签由安全UUID构造 `idea-<record_id>`；未保存窗用 `idea-draft-<draft_id>`。创建成功重绑registry中的record_id，不要求销毁重开原生窗口标签。标签不使用用户标题或文件路径。Rust `idea_windows`只负责创建/聚焦/生命周期/消息转发与来源检查，不做内容业务。

已存记录打开命令校验UUID、记录存在且kind为想法；草稿打开校验draft身份及quickbar真实来源，不以“记录不存在”降级为新建。原生维护运行态registry(record_id或draft_id、window_label、window_session、main_epoch)，不另存笔记库。新窗无fs、save_quick_record或通用shell权限；capability只给窗口/事件及窄笔记桥命令。来源window_label由Rust调用上下文取得并与registry校验，不能信任payload自报的窗口或record_id。

统一共享schema（与application DTO/输入类型派生）：

- hello/load：request_id、window_session、record_id；main通过readSerial返回IdeaDocument、main_epoch、view_seq和下一operation_id。
- save：上述身份 + main_epoch、operation_id、record_revision、title/details_markdown/needs patch；main经同一updateIdeaInTx/commit/journal执行，不通过子窗写文件。
- draft-load/draft-create：draft_id、draft_version、移交快照、create_operation_id及真实来源会话；未创建不造record_revision，按上节状态路由create_idea，创建reply同时给原操作身份与真实record_id/record_revision。旧create重试与随后update请求类型明确分开。
- reply：request_id及标准committed/error；save结果带IdeaSummary与next_operation_id，当前视图按实际已提交patch更新基线，其他视图必要时get详情；未发送、已提交、结果未知分开，未知先用原operation_id查回执。新写回执不回显未改的长正文。
- committed通知：record_id、window_session、main_epoch、递增view_seq、最新record_revision；需要更新内容的已打开视图才加载正文，不把每次计时心跳当成全文广播。

同会话view_seq拒绝迟到回复；main_epoch不匹配的保存拒绝，旧草稿保留。内容record_revision跨主窗重载稳定，但不能替代来源epoch。重新绑定必须由主窗的明确打开/重新加载动作完成，dirty窗不得自动用新epoch/base覆盖旧草稿。查已发送操作结果是只读核对，不因内容冲突而禁止回执读取。

编辑过程中发送保存后又产生新输入，只在reply对应的草稿版本仍是当前版本时清dirty；否则更新已保存基线并保留新输入。不能以“收到保存成功”就无条件清空编辑器。

## 主窗隐藏、关闭与安装更新（v0.2，D1）

主窗隐藏到托盘时仍运行并处理笔记请求。主窗F5/换目录产生新epoch，旧保存不执行。应用真正退出、笔记窗关闭与安装更新都必须考虑未存稿；现tray.exit直接app.exit(0)，须接入本次文档草稿保护，不能仅拦窗口X而漏掉退出。

正常“更换数据目录”也走同一未存稿检查：先处理旧目录的草稿，再关闭/解除旧目录clean窗口绑定，不把同UUID旧笔记误当成新目录记录。同ID复用指当前数据目录中的同记录；不把Windows路径放进共享内容契约。

复用现有pauseCommits及QuickSaves的维护/保存准入，不新增第二套业务写锁。现prepare_install只向quickbar问dirty，要扩到main内容编辑、quickbar和所有已注册笔记窗：

1. 原子冻结新写入/新编辑窗的准入，保留并完成已接纳提交；保留现安装取消恢复路径。
2. 向实际存活且ready的视图发送有request_id的草稿检查；视图先锁定编辑，再读取实际草稿，回传dirty/saving状态（无debounce缓存）。
3. 标题、详情、needs等实际草稿与基线不同都算dirty；收起、隐藏或切换类型不使草稿变clean。纯阅读/预览显示状态不算内容修改。
4. 未ready、关闭/失联或检查失败不能当clean。安全关闭已确认保存/放弃才可从检查集合移除；异常销毁使检查明确失败。用户可取消等待，释放原维护准入，不新增固定超时/轮询上限。
5. 任一dirty、saving结果未知或检查失败时**取消本次维护**：先执行并确认原生cancel_install/对应维护取消，移除pending检查并确认installing等维护状态已解除；再恢复pauseCommits的接纳和各视图原编辑状态，最后聚焦对应窗口让用户用常规保存/放弃。解除失败明确报错，不能假称已恢复并让保存碰冻结门。此处不在冻结队列中等保存、不发特殊保存ticket、不绕行quick_save。
6. 用户处理草稿后，再次触发安装更新/真正退出/换目录，从第1步重新冻结、排空和完整检查；不自动沿旧检查继续，不缓存先前clean答复。取消维护不取消已接纳的业务提交、不清dirty。成功退出只在该次检查所有草稿已处理且队列排空之后。

普通未交接Quickbar新建仍是既有窄旁路，按照ADR0026同一编码写入；已交接草稿的原条/笔记窗创建均走main，已存笔记编辑也不走该旁路。不会为本功能顺手重写mini计时和更新渠道业务。基础架构§3.2的记录条只允许create_new描述，接受本ADR后需加已交接草稿的窄桥例外及修订历史，未Accepted阶段不覆盖旧规范。

D1及本稿QuickBar状态机/旧快存对账/原操作回执语义已由coder在`01M6WQ0E9RJHRDE1A06EZVBYZ7`定向技术复核通过；本基线已另获最终审核Accepted。原型QW1/QW2已报阻塞均关闭，用户已确认；正式实现与原生验证仍按下述矩阵，不把方案通过当原生验收。

## 影响文件

app/IdeaWindowApp、app/ideaWindowController、platform/ideaWindowBus/ideaWindows、shared/ideaWindow协议、Idea详情widget与主窗接线；QuickBar草稿状态/准入/原条保存路由及附件交接；idea.html/Vite入口；Rust idea_windows/lib/build/tauri capabilities、quick_save更新检查、tray退出路径。历史来源增加手动idea-window标识，内容操作仍记record主体，不伪装成main或automation。

## 原型与验证

浏览器原型需真实新开可调整大小窗口，不只是拉大抽屉；main为唯一已提交状态，子窗仅草稿并经来源校验消息保存。原型window.open/postMessage与正式Rust桥的差别写明，不当正式权限验收。

原型必须覆盖主审已发现的边界：opener缺失/关闭时明确main unavailable并保留草稿，不能读localStorage后在子窗降级保存或假称同步；main每次加载产生新epoch，不继承固定epoch-1；windowSession实际绑定来源Window/record，不能只查前缀；window.open返回null时不注册active ID、不提示成功，允许重试。IDEA_COMMITTED校验epoch/view_seq，旧或重复通知不覆盖内容/清dirty。上述边界结果留存日志，正常opener场景console全过不能代替。

必测：新开大窗且原页保留；同IDdirty只聚焦、不同ID并开；读/编辑与CLI/main同修订；保存一处所有clean视图更新，dirty不覆盖；旧epoch/错ID/错来源/迟到reply拒绝；保存后继续输入不丢；关闭保存/放弃/取消与失败保稿；main隐藏可保存、重载不能旧写；安装更新/真正退出覆盖所有未存详情、异常关闭不假clean；无fs写权限、未改timer/task。

已有记录W1–W4原型阻塞已由coder在`01M6WN29P99MW599WHR7QTATTG`源码及11步真浏览器报告定向复核关闭。coder在`01M6WPVK9901JBGY2RNNE3PEB9`关闭QW1条件清稿/S13已报场景；在`01M6WQEN9B1TXFND92NZY6Y2N3`关闭QW2：首次规范请求/原回执为唯一依据，缺回执字段显式invalid_operation_receipt；首次A后改B或删除时原A重试仍回原结果，同ID换B冲突，两路记录数不增。主审点验verify-v033-proto.mjs:724–760、verify-multiwin-e2e.mjs:779–784及14步归档。证据为`../../../原型/v033-idea-detail-mainline/verification-report.md`和同目录JSON；用户随后确认原型。成员浏览器报告与主审源码/断言复核不是正式持久回执或Tauri验收。

| 新增回归 | 必须观察到的结果 |
|---|---|
| 开草稿窗→原条继续改标题/详情/needs→子窗保存 | 原条后写逐字保留，dirty不清；真实record_id关联明确，下一次保存不自动重复创建 |
| 原条先保存→子窗相同请求/不同内容保存及重试 | 相同原操作返回原回执，异内容冲突保稿；记录数只增1；明确核对后才能update |
| 子窗先保存→原条保存/两端相邻点击 | 同一状态路由main；一份create规范输入确定，无create_new旁路第二份 |
| 成功回执丢失→重查/原create重复消息→已创建记录另被编辑 | 回原操作结果、不按当前正文判断重放，不重建、不静默覆盖后续记录 |
| 原A创建→删除真实记录→原A重放 / 原ID改B | 原A回首次回执、B冲突，两者都不重建记录；回执字段缺失明确失败、不从现值补齐 |
| 本地quick_save在交接前已接纳/成功后通知失败 | 先结清原record_id和快照，对账后开真实记录；未知不另建 |
| 交接握手未完、弹窗失败、子窗关闭、main重载 | 无假成功/自动清稿/撤销已提交；旧epoch拒写，原身份可只读对账 |
| 更新冻结检出仅正文dirty→选择保存→再次更新/退出 | 顺序为取消维护确认→恢复准入/编辑→常规保存→新一轮完整检查；无冻结中等保存死锁 |

这些行为须先做隔离原型竞争回归，随后做正式原生QuickBar/main/文档窗与持久回执验证；原型运行态映射不能代替跨进程恢复证据。

## Revision History

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-11-08 | 记录用户新开大窗口要求；同记录复用/不同记录并开、main单写入、revision+epoch、草稿与关闭/更新/退出、窄原生桥；待原型与全员审核 |
| v0.2 | 2026-11-08 | 跟随用户入口/名称局部反馈与未保存QuickBar草稿开窗；D1明确取消维护确认后再常规保存并重查；draft身份/版本/快照、local至committed路由、原操作回执/异内容冲突及旁路相邻对账；记录W1–W4和QW1已报场景关闭、QW2原操作重放待验，仍Proposed |
| v0.3 | 2026-11-08 | 用户确认原型后固定仅详情/想法草稿开窗入口、去外标题壳/边距与贴边直角；记录QW2首次回执/缺字段失败/删除后两路不重建的定向复核关闭；补生产回归与ADR0029，最终审核仍待 |
| v0.3 Accepted | 2026-11-08 | coder最终审核通过；补审核记录与接受状态，窗口/草稿/维护/回执协议不变，实施后按原生矩阵验收 |
