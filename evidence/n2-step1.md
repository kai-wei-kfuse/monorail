# N2①：代码术语改名，磁盘仍为 v1

2026-10-28。

- 计时 category → project；背包 Project/project → Task/task；关联属性改为 task_id、taskId、bet_task_ids。
- 改名覆盖领域、服务、投影、前端类型与调用、测试；投影动词 projectHome/projectBackpack/projectReview 保留。
- data/v1Codec 是 v1 字段名映射的唯一来源；Markdown、计时 YAML、设置 YAML、记录条保存都使用它。
- 磁盘 project_id、bet_project_ids、category 与 projects/ 保留；schemaVersion 仍为 1。版本号升为未发布的 0.2.0。
- 新增 v1Codec 回归：旧字段读入、更新后旧字段写回、未知字段与正文保留、旧任务目录、计时和设置字段、记录条转换。
- npm run check：37 个文件、228 项测试通过。数据迁移和计时规则尚未在本步骤启用。

Claude 可在本步骤提交后继续 pages/：TaskDialog、TaskList、TaskDraft、TaskView、taskId 取代旧名称；计时项目字段现在叫 project。

0.1.4 已在 14:25（Asia/Shanghai）发布，CI 40642244204 成功。Release 指向 69329f6；之后的 cbe1b11 布局修正已保留在本地 master，未改写发布 tag。evidence/release-0.1.4/ 保存了核对通过的更新清单及签名。Windows 人工冒烟与应用内更新由用户验收。
