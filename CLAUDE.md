# 单轨（MONORAIL）开发约定

依据上级目录《架构设计》v1.1、《设计文档 v0.2》附录 A、《首期开发计划》。

## 分层
- app 是组装根，可引用全部层；data/repos 创建仓库和 transact，bootstrap 注入。
- shared 只有通用类型、工具和默认设置；domain 纯函数只依赖 shared 和已声明的 domain DAG。
- data 管格式、校验、IO、journal；可以引用 domain 类型，不包含业务决策。
- platform 封装 Tauri，只依赖 shared；service 只通过注入的接口使用平台能力。
- store 只接收提交后的投影，不调用 service、不做 IO。
- services 只依赖领域规则、数据接口类型、store 和平台接口类型。
- ui 零业务，只依赖 shared；widgets 依赖 services/store/ui，互不引用。
- pages 依赖 widgets/services/store/ui，页面之间互不引用。
- 层方向由 no-restricted-paths 检查，运行时环由 import/no-cycle 检查。

## 事务与 service 方向
- 用户动作调用 run(rootCtx, callback, at)，并发根动作串行排队。
- callback 只把 tx 传给 InTx 函数，不能捕获根 ctx 调另一个用户动作。
- InTx 只接 tx（自带 repos/settings/id/now/at）；run(tx, ...) 同步抛重入错误。
- cardService → degradeService 的 InTx → timerService。
- cardService → dealService；其余 service → timerService/dealService。
- reviewService → backpackService/ideaService 的 InTx（主线与回顾进度同事务）；任何 service 不得反向调用 reviewService。
- timerService/dealService 不调用其他 service；degrade 的「回来」只调 timerService。
- picker 只由 dealService 调用；其余跨 service 调用禁止，评审检查方向。
- Write 对 services 不透明：只能收集仓库生成的对象，不拼路径、不构造 Write。
- seq 只由 tx.nextSeq 分配；跨日物理切片保留同一逻辑段 id/seq。
- 启动先恢复 journal，再扫描/校验 max_seq 和 open_segment_day；普通动作只读当前段日期+今日。
- settings.yaml 是当前配置来源；只有缺文件的新目录使用 shared 默认值，坏文件必须报错。

## 术语
- record：输入记录；card：任务卡；task/backpack：任务/背包；project：计时项目。
- N2①：代码已改名，磁盘仍为 v1；data/v1Codec 保留 project_id、bet_project_ids、category，任务仍写 projects/。N2③才切换格式。
- segment：逻辑计时段；effective：补记覆盖后的有效时间线；day：活动日。
- reconcile：幂等补齐记录生成的卡；InTx：现有事务内编排，不再次排队。
- journal/transact：可恢复的多文件提交；publish：提交后投影更新。

## 验证与协作
- `npm run check`：tsc → eslint → vitest；`npm test` 对整个测试进程限制 60 秒。
- 测试期限仅由 test-runner.mjs 控制；Vitest 不另加单项 5 秒默认期限，防止并发负载误报。
- `npm run tauri -- build --debug --no-bundle`：普通 Windows 构建。
- 使用已安装 Rust 1.95.0，不改全局默认；npm/Cargo 锁文件必须提交。
- 验证入口只在 Cargo verify feature/Vite verify mode；不进生产包。
- 200 行（组件 150）是职责检查提醒，不机械拆分，不写类型/导出镜像测试。
- 只暂存本人负责路径；公共文件修改前通知团队；不回退其他成员改动。
- evidence 保留运行证据；未实测不能写成通过。
