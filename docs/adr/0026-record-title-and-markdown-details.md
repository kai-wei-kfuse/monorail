# ADR 0026：记录标题与 Markdown 详情

状态：Accepted v0.5 · 2026-11-08。唯一维护方：coder-6。coder最终审核通过；本版只想法Markdown，待办保持旧多行语义。相关[范围提案](../stages/changes/0.3.3-title-details-main-tasks.md)、[执行方案](../stages/0.3.3-execution-plan.md)、[ADR0028独立想法窗口](0028-idea-document-window.md)、[ADR0029自动化同版契约](0029-v033-automation-parity.md)。保持已审内容规则，Accepted不表示产品已实现。

审核：[0.3.3-final-plan-review-coder.md](../../evidence/0.3.3-final-plan-review-coder.md)；Runner `01M6WSEHW6ZX6YECSPYQEFV4CJ`。同一v0.5基线仅更新接受状态与引用。

## 问题与不变量

0.3.2 的 RecordEntry 只有 text，MdRepo 另返回 body。新建或改 text 时 commit 将 body 写成 text；QuickBar 也如此。夹具证明 body 可已有不同长正文。因此不能直接占用正文槽而不定义旧数据与读写规则。

目标不变量：

1. 新格式的想法 `records/<id>.md` 中，YAML `text` 是唯一标题来源，结束线后的 body 是唯一 Markdown 详情来源。API 的 title 映射到 text，不再保存另一份 title/detail 元数据镜像。待办记录本稿保持旧格式语义，不能默认全类型拆分。
2. 改标题不改变详情；改详情不改变标题；池状态、needs、完成/撤销等元数据动作保留详情。未给详情表示保持原值，空字符串表示明确清空。
3. 标题/摘要进入列表和已提交快照；详情不进入所有事务、投影和历史比较副本。附件路径、标签、关联和未知元数据保留。
4. 所有写入复用服务/commit/journal。QuickBar 的窄写入口采用同一内容编码，不再 encode(value, value.text)。
5. 详情不成为卡的content、计时名称或自动生成子项。想法转任务预填标题，显式事项经ADR0029同源转换，原记录详情完整保留；待办维持旧text / Card.content多行语义，本版不新增待办Markdown详情。

## 内容格式与 API（v0.5）

保持同一 records 目录和 UUID，使用 schema3 作为格式切换候选；不改时间条目格式。

只对已确认原型中的想法建立新格式：YAML `text` 是标题，body 是详情。待办记录和Card.content保留旧语义，不拆分或复制详情。后续新增待办Markdown须另有对应阶段范围/映射/契约，本版不以旧待答阻挡开工或扩范围。

选择**新增方法**，不在旧 save_idea/capture_todo 内增加 title/text union。新旧入口调用同一内容服务，旧接口仅作边界适配，不能复制业务规则。

`IdeaSummary` 为严格 DTO：`id`(UUID)、`title`、`tags`、`needs`(string|null)、`attachments`(相对路径数组)、`pool`(活跃池/冷库/已转任务/已完成)、`created_at`、`last_touched_at`、`has_details`、`record_revision`。`IdeaDocument`=该摘要+完整`details_markdown`，仅详情查询返回全文。

新写回执返回摘要，不把同一份长详情又塞进receipt.data；规范化input仍完整保留。因此只改标题不会为未改正文再存一份全文。旧save_idea必须保旧text回显，其既有input/data副本不变；不把“不回显未约定字段”写成正文截断。

| 方法 | 精确输入 | 输出/语义 |
|---|---|---|
| save_idea（旧） | 原 operation_id/text/needs 保持；text 按原 schema trim 后可含多行 | 原 committedEnvelope 与 ideaResult 形状；data.text 返回本次原 schema 处理后的完整 text，不缩成首行；回执 input 仍为原 text/needs |
| capture_todo（旧） | 原 text/task_id/due_at/blocking 保持 | record/card/task 与完整 card.content 语义不变；待办记录暂不做想法式拆分 |
| find_items（旧） | 原 kind/query/include_archived 保持 | 想法按兼容全文 C(title,details)、tags、needs 匹配；ideas[].text 返回 C，旧后半段默认可查；todo_cards[].content 不变 |
| create_idea（新写） | operation_id、title(string，可空)、details_markdown?(默认空)、needs?(trim→null) | committedEnvelope({idea:IdeaSummary})；title 禁止换行，详情不 trim/截断；标题/详情/附件至少一项有实际内容 |
| get_idea_details（新读） | idea_id(UUID) | {idea:IdeaDocument, operation_id, as_of}；operation_id 用于后续写，不落盘；只读同一串行提交视图 |
| update_idea（新写） | operation_id、idea_id、record_revision；title?/details_markdown?/needs?(string\|null)，至少一项 | committedEnvelope({idea:IdeaSummary,noop})；仅显式字段改变；省略详情保持、空串清空；不改生命周期/任务卡；修订不符返回 RECORD_CHANGED 与 latest_context.idea摘要，需要新版正文时显式get详情 |

旧complete_idea/reopen_idea的text结果同样用兼容全文C，不偷偷改成仅标题；旧持久回执不改写。get_operation_result与新旧操作重放沿现有规范输入比较。新增create_task/convert_idea_to_task的公开任务契约由ADR0029定义，使用本ADR的IdeaSummary/record_revision，不另定义详情格式或复制长文。

兼容全文 C 的精确定义：D为空返回A；A为空返回D；D以LF开头返回A+D；其他返回A+LF+D。这保持旧正文单字段语义；读取后的换行统一 LF，旧创建回执仍回显原 trim 后字符串（含其原有内部换行）。不往旧严格输出中塞 title/details 新字段。

CLI：旧 `idea add`（位置 text/--text-file/--stdin）仍调用 save_idea；新 `idea create --title ... [--details-file ...|--details-stdin] [--needs ...]` 调 create_idea（仅详情创建可省略 --title，由CLI显式传空标题）；`idea show <id>` 调 get_idea_details；`idea edit <id> [--title ...] [--details-file ...|--details-stdin|--clear-details] [--needs ...|--clear-needs] [--record-revision ...]` 调 update_idea。文件与 stdin 互斥，不 shell 拼接正文。

### 输入/输出兼容样例

以下用 \n 表示 LF，ID/日期略：

- 旧 save_idea 输入 text=`看视频\n稍后看 https://example.com/a\n#服务器`，回执 data.text 仍是这整段，tags=[服务器]。存储标题=`看视频`，详情=`\n稍后看 https://example.com/a\n#服务器`；首个换行留在详情，兼容拼接可还原整段。
- find_items(query=`稍后看`) 必须命中上述记录，ideas[].text 仍返回整段；query=`服务器` 可按正文/标签命中。不是只搜标题。
- 新 create_idea(title=`看视频`,details_markdown=`稍后看 https://example.com/a\n#服务器`) 回执返回title/has_details/修订摘要；get_idea_details返回两个独立字段。旧find_items呈现`看视频\n稍后看 https://example.com/a\n#服务器`，现代详情界面只显示一次标题。
- 旧 capture_todo(text=`改登录\n补回归 #测试`) 的 card.content 仍为整段，tags 保持原行为；本稿不把待办后半截挪走。
- 旧 save_idea 的已有 operation_id 原样重放，即使记录已迁移/编辑，优先返回旧回执 data，不重建或改写记录；同 ID 改 text 拒绝 OPERATION_CONFLICT。

## 旧数据映射（v0.3，固定算法供审核）

只作可复核的机械映射，不由 AI 改写。N(s) 将 CRLF 和单 CR 统一为 LF，除此之外不 trim、截断或改 Markdown；原文件字节在备份中保留。T=N(旧text)，B=N(旧body)。i=T 中首个 LF 位置；没有LF时 A=T、R=空，否则 A=T[0,i)、R=T[i,末尾]，**R保留该LF**。

| 旧文件 | 标题 | 新详情 | 保全要求 |
|---|---|---|---|
| T 单行且 B=T | T | 空 | 镜像标题不重复展示 |
| T 多行且 B=T | A | R | 原多行内容/首个换行保留，不只留下首行 |
| B 空 | A | R | 不丢 YAML 原多行内容 |
| T非空，B以T为前缀且后缀从LF开始（或T以LF结束） | A | R + B.slice(T.length) | 只去除完整行镜像，保留外部追加原文 |
| B非空且不以T为前缀 | A | R为空则B，否则R+LF+LF+B | 两份不同内容都保留；只在两段之间加精确定义的两个LF |
| T 为空的合法旧记录 | 空 | B 原文 | 附件/正文保留，不能强制写默认标题 |

条件顺序：T为空先取空标题+B；其次B=T；其次B为空；其次满足完整行边界的T前缀；最后不同正文。B=`标题补充`、T=`标题`不算行镜像，保留整个B，不把词拆开；无行边界的其他前缀也走不同正文分支。空首行不编造标题；例如T=`\n资料`、B=T→A为空、D=`\n资料`。T=`标题\n`、B=T→D为一个LF，不能把它默默删成空。T仅空白且B无实际内容、无附件时按已有内容完整性规则报带路径错误并中止，不用默认标题掩盖坏记录；有附件或非空正文则保留。

新 createRecord/editIdea 保存门统一变为 `title.trim() || details.trim() || attachments.length`，只用于判断记录是否有内容，不据此 trim 落盘正文。旧“只有text或附件”门不能继续拒绝正文型记录。

### 标签派生（v0.3）

迁移原样保留已有 tags，不把正文标签抬进标题。明确内容编辑时用同一 helper 对 C(title,details) 调现有 extractTags；标题和详情的标签都参与，按首次出现顺序去重。Markdown 标题/URL fragment 仍按现有正则不匹配；**代码围栏/内联代码不新增特别排除**，保留旧纯文本标签语义。原始 HTML 不能执行是渲染规则，不改变该提取输入。

只改 needs/池状态/完成/撤销/簿记不重抽 tags。标题/详情值没变的 noop 也不重抽。实际内容变化时按当前全文重算，因此删除文本标签会删除对应派生标签；旧非首行 #标签在仅改标题后仍因详情参与而保留。GUI/QuickBar/CLI/MCP 均调用该 helper。

## record_revision、冲突与重放（v0.4）

record_revision=`ir3:`+SHA-256(UTF-8(canonicalJson({id,text,details_markdown,needs,tags,attachments})))。text为已存标题，details为N(body)，needs为已存null/string；对象键按现canonicalJson排序，数组保持已存顺序。无 Windows 路径、mtime、计时状态或显示截断；由服务发出，客户端复制。

创建/改标题/详情/needs/tags/附件改变令牌；读取、preview、池状态、完成/撤销、last_touched_at、cold_since、completed_at/by、created_via、history_logged_at、主窗重载和计时不改变令牌。QuickBar 新建另一记录无影响；主窗吸收该记录补 history_logged_at 不让令牌失效。只读取得修订不算触碰/续期。

update_idea 在同一事务先查旧回执，再读取真实目标/修订；相同 operation_id+规范请求返回旧回执，优先于当前修订。新操作修订不符返回 ApplicationError(RECORD_CHANGED,not_executed,latest_context.idea摘要)，保持草稿，不刷新修订重做；正文对比通过显式get_idea_details，不把全文自动附在失败回执中。

规范 create 输入固定包含 title/N(details或空)/needs；旧 save 输入保持原trim text/needs。规范 update 固定包含 idea_id/record_revision，并**仅包含实际提供的patch字段**，正文N但不trim，省略与空字符串不同。

CLI首次编辑未指定修订时只读get_idea_details取得令牌。显式operation_id重试先get_operation_result：已有同方法回执且未显式给record_revision，仅恢复回执原record_revision；本次title/details/needs不从回执覆盖。尚无回执才读取当前令牌；用户显式修订始终参与请求比对。窗口请求另外验证mainEpoch，不能拿内容令牌替代来源会话。

### 原始字节与语义换行（v0.4，D2）

分清两种比较：外改检查使用磁盘原文件字节的哈希，写目标另外取得原 body 字节哈希；内容修订及正文历史 digest 使用 N(body) 的 UTF-8 字节。外部把 LF 改成 CRLF 会改变原文件/body 哈希，但不改变 record_revision 或正文语义历史；新事务接纳该磁盘基线后，未改的正文仍原样写回。已读写基线之后发生这种外改仍拒绝本次写入，不能因语义修订相同而跳过原字节核对。

现 frontmatter.decode 先对整文件归一 CRLF，再返回 body，不能拿其 body 当原始正文。为记录专用读法在 frontmatter.ts 明确拆出**原文件中的头部边界与原 body 切片**，只对头部进行 YAML 解析；记录摘要从临时原 body 计算 N、标记与 digest，不把原 body 常驻缓存。写目标重新读取原文件，按同一边界取得 rawBody，核对本事务原文件哈希后生成写计划。原 UTF-8 字节读取/哈希由注入的文件接口提供，不能只用 mtime:size；若从文本重编码核对，必须先证明它完整保留源 UTF-8/BOM/换行，否则使用原字节接口。非法编码或无法识别 frontmatter 必须报带路径错误，不以空正文替代。

| 动作 | 落盘 body | 内容修订/历史 |
|---|---|---|
| 打开、预览、查详情 | 不写文件；向客户端返回 N(rawBody) | 不触碰修订/历史 |
| 仅标题、needs、附件、生命周期、簿记变化，或省略详情 | 复用目标原 rawBody 字节，不使用 normalized body 重编码 | 用实际最终 N(rawBody) 派生；标题/needs等按既有字段规则变化 |
| 显式详情 patch 与 N(rawBody) 相同 | 保留 rawBody；若其他字段也未变则 noop | 不新增正文变化历史，不为统一换行写文件 |
| 显式详情 patch 的 N 值确实不同，含明确清空 | 写 N(所提交详情)；清空写空 body | 从实际新正文同提交计算修订/has_details/历史 digest |
| 新 create_idea、旧 save_idea 适配创建、v2→v3 迁移 | 写规范 LF body；迁移仍按固定 A/R/B 算法 | 原始迁移文件字节完整备份并读回核对 |

标题-only 可以重新编码 YAML/frontmatter，但结束线后的原 body 字节必须相同；不承诺整个文件逐字不变。任务、卡与冻结旧迁移读法不为这个记录专用能力顺手换编码。journal 的 text/before 沿原格式保存可逆的 UTF-8 原文；若字节读取证明此格式不能保全某个合法输入，先明确报告并修订迁移方案，不能静默丢字节。

D2主审定向技术复核已由coder在`01M6WQ0E9RJHRDE1A06EZVBYZ7`通过；整体v0.5另已通过最终方案审核，原始字节路径的产品实现/原生验证由实施阶段完成。用户原型已确认，流程仍为coder-6定稿→coder审核→coder-3实施→coder-6与coder审核，不再保留旧两项答复/全员前置门槛。

## 迁移与回退候选（v0.2）

- schema3 有现实原因：旧 0.3.2 修改同一记录 text 时会覆盖新详情；仅打开、reconcile 或不改 text 的元数据保存不会因此清空 body。仅正文布局新增不必然需要 schema 升级，但不能因此声称直接降级无损。
- 冻结 v2 读取，逐文件备份并读回核对；新记录映射、state/settings 切换放一份 journal；迁移中主窗口/QuickBar 写入封闭。
- v1→v2 的已冻结规则不改；如旧目录需两段迁移，分别记录阶段与备份，不重新解释旧计时。
- 直接回到 0.3.2 读取 schema3 目录不支持；回退使用验证过的 v2 备份目录，明确新版新增/修改内容不自动回灌旧目录。
- 已发布的 0.3.2 面对 schema3 是 `state.yaml: invalid state` 解析拒绝，不是可补写的友好“较新目录”提示。源码模块探针已验证无 journal 时哈希不变，但不是已安装 EXE 验证。
- `recover` 早于版本检查，旧 Journal 会应用它能读懂的计划。不能靠给 journal 塞新字段阻止旧读法，不能声称 schema3 挡住恢复。
- v3 迁移 journal 使用已有 id/path/text/before 结构；备份成功后构造完整计划，首项写 state.schemaVersion=3，再写 records/settings。对每个替换前后中断，分别用旧 Journal/新入口恢复，证明完整最终值和幂等，不逆向丢详情。旧版先完成整份迁移再解析拒绝是允许的恢复结果。
- 升级/回退测试须包含已安装 0.3.2 EXE 的写门与文件哈希，以及 state 仍为2但存在完整未执行 journal、state 已为3且正文只改一部分的中断点。原样模块探针不替代原生二进制验证。
- 运行态 state/schema 只直接解析3；迁移入口明确识别2→3，1仍先用冻结1→2再迁移，不把未知版本当1。原生 CURRENT_DATA_SCHEMA_VERSION=3。
- 发布 manifest dataSchemaVersion=3，历史兼容字段 readableDataSchemaVersions=[2,3]：2表示可接受旧目录并迁移，**不是stateRepo直接解析2**。必须保留2让已发布0.3.2选择器能选中升级；3让本版选择器识别自身兼容。直接可读=[3]、已验迁移来源=[2]分别记录，不宣称所有旧版直接可读。旧schema1路径单独演练，不因有迁移代码就额外承诺旧客户端自动升级。
- 升级：已安装0.3.2编译常量2→选本版兼容列表2→安装本版→备份迁移→state3；回退：本版编译常量3不能选择仅兼容[2]的0.3.2覆盖当前目录。CURRENT常量/manifest/历史兼容表/readable列表由version检查与原生测试联动，不只改TS。

## 读取、缓存与历史（v0.2）

本版基线采用记录专用摘要读法：每次事务仍枚举并读取所有记录文件字节，计算原文件哈希并得到 metadata/详情存在标记，但缓存和事务不保留全部 body/full text。只有详情打开、明确内容查找或写目标时持有该实体的正文。新方法返回真实摘要类型，不能把 body/text 清空伪装成原 Entity。

这样省的是重复解析/缓存/克隆和 YAML 镜像，不宣称删除了全量文件 IO。mtime:size 无法证明同长度、同 mtime 的内容没改；哈希也必须先读字节。跳过已知文件读取不进入本版基线，除非后续有可靠变更证据并独立论证。

QuickBar 新 ID 在当次事务必须解析 created_via/history_logged_at，先补记历史再物化待办，不能等打开详情。写目标懒读真实 Entity 后，与本事务摘要里的原哈希核对；变化明确报错，不能采用被外部改过的新正文作为旧基线。

摘要是内存派生缓存，不另存权威。未提交新值不能提前发布；journal 后磁盘已变但投影失败时，后续读取必须按磁盘重算，不能信旧摘要。数据恢复、投影失败、目标外改、新文件吸收逐项验证。

has_details 为实际最终 body.length>0 的派生摘要，不在 YAML 再存一份权威。创建/迁移/正文修改/清空在同一提交计算它和record_revision；只改标题/needs保留实际正文后重新派生，提交成功才发布。摘要不能留 Entity.text（整文件）或 Entity.body，二者都含长文。

正文变化但标题不变仍进 domain/history/compare.ts 的记录字段表：采集只持有前后正文digest和has_details，不把全文交给历史。字段“详情”的比较用digest，显示用“有详情/空/已更新”；即使首60字一样，digest不同仍产生一项详情变化。同正文不产生该项。digest仅作内部比较，不显示哈希或改变HistoryChange的string形状。记录、派生标签、历史与回执一份journal。

既有 8KB 参数副本截断和 60 字显示摘要沿用；回执规范化输入仍完整保存且无自动清理。新增/更新长详情的回执副本与一次迁移备份计入存储评估。

## Markdown 阅读

正式 UI 采用成熟 Markdown 解析/React 渲染方案（候选 react-markdown + remark-gfm），不把原型的小解析器当成正式实现。编辑态始终保存原文；阅读态支持段落、链接、列表、代码等标准 Markdown。

不开原始 HTML 执行；链接由统一 URL 校验与平台注入的打开动作处理，仅 http/https，拒绝 javascript/data/file。不爬网页、不解析视频、不自动下载链接内容。正文不当计时命令；#标签提取按前述兼容规则，不能一边宣称不读代码、一边使用原纯文本正则。

原生外链接线：app注入platform.openExternalUrl，Rust新增窄 open_external_url，解析url并再次验http/https后调用系统浏览器；注册lib/build commands与main/quickbar/想法窗capability，不给正文file/shell通用执行权限。原型渲染器不搬进app。

新窗口读/编辑同一内容与修订，完整协议、草稿、关闭和安装更新见 ADR0028；不从新窗口直接写文件。

## 验证

映射矩阵、重复编辑和生命周期保留；CLI/MCP 与 GUI 同内容；旧方法多行回归；详情修订冲突、同操作 ID 换正文冲突、结果未知回查；Markdown 危险内容；合成规模的冷启动/提交 IO、内存、详情读取与磁盘增量；真实数据只在只读副本中演练；0.3.2 原样拒读与回退备份。D2追加：CRLF/单CR/混合换行正文在打开、仅标题/needs/完成/簿记、显式相同详情保存后原 body 字节不变；真正详情修改与迁移才写 N；同语义不同原字节令牌相同、外改仍拒绝；正文摘要与实际最终原 body 一致。

## Revision History

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-11-08 | Proposed：唯一标题/body 详情、旧映射矩阵、schema3 候选、按需加载和 Markdown 安全；待用户边界与全员审核 |
| v0.2 | 2026-11-08 | 按原样模块探针纠正旧版为解析拒绝、旧 journal 仍会恢复；完整迁移计划 state 首项与逐替换中断验证；摘要读法保留全文件 IO但不缓存全部正文，避免 stat/hash 伪优化；仍 Proposed |
| v0.3 | 2026-11-08 | 固定新增3方法而非旧method union、旧多行输入输出与默认全文查找、保留首LF的逐字映射、正文型保存门、全文标签派生、内容修订/CLI重放、has_details/详情历史及原生schema兼容列表；关联新窗口ADR0028；仍待全员审核和两项用户边界 |
| v0.4 | 2026-11-08 | D2分离原文件/body字节哈希与N语义修订；记录专用原串边界读取，标题/needs/生命周期及相同详情patch保留rawBody，只有实际详情变化/创建/迁移写N；补原生UTF-8字节与换行验证，不自称已实现或Accepted |
| v0.5 | 2026-11-08 | 按用户原型确认收口仅想法Markdown/待办旧多行，替代旧待答门槛；新增ADR0029引用以同版交付CLI/MCP五方法，标题转换保原详情，内容规范仍唯一；D2已有技术复核，待coder最终放行 |
| v0.5 Accepted | 2026-11-08 | coder最终审核通过；补审核记录/Runner引用，仅变接受状态，内容/迁移/API规则不变，非实现验收 |
