# N2②：计时契约与 v2 底座

2026-10-28。当前应用仍使用 v1 仓库；N2③迁移、N2④接入完成后统一切换。

- domain/timeline/entry、place、edit：可编辑条目、切换/叠加、离线 claim、固定时刻的读数预览与确认、卡累计时长下界。
- services/tracking/api：全部 InTx；计时不读取卡，只保存不透明引用。暂停、插入及恢复共用回到目标。
- data/timelogV2Repo：按开始活动日单份存储；跨日相交查询；多文件移动/删除经现有 journal；发布后才更新内存索引；全局不变量验证。
- ESLint 强制 tracking 不引用卡侧模块，其他 service 只能经 tracking/api 访问内部模块。
- 回归覆盖 A1 两种重叠语义、待机拆分保留运行 ID、R1、R2、R3、迟到目标、嵌套暂停/插入、跨日存储、journal 中断恢复。
- npm run check 已通过；当前并行 UI 新增测试也纳入全量检查。shared/time.ts、shared/time.test.ts 是 Claude 的改动，本提交不暂存。

架构设计 v1.2 已完整核对。对外接口把点击时刻放在 tx.at，符合 InTx 契约；正式接入时仍需将现有卡侧直接读取计时段的路径迁到该接口。
