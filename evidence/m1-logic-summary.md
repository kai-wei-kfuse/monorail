# M1 首页核心闭环逻辑验收

2026-10-27。对应任务 `01a17923-f1f8-7e93-9685-b5ce6ec52d7b`。本报告区分自动化服务验收与真实桌面操作，不把 MemoryFs 测试当成原生 UI 实测。

## 已完成

- A2：插入活动中完成、缩小、再抽均在点击时刻结束插入，不残留返回目标；时间盒确认只读，实际完成沿用最初点击时刻，确认与填写进度跨日也不改变归属日；续卡幂等。
- A4：reconcile 同事务补卡、回填 record.card_id、更新首页并同步期限提醒；重复执行不重复建卡；修改记录不覆盖卡的执行字段；想法不入选卡池。
- A6：两级缩小链按直接父卡恢复进度；叶子 PASS 可恢复父卡并重新缩小；已缩小祖先不可 PASS；缩小卡不能续卡；无效缩小不计拒绝且不写任何卡或计时。
- A7：第四次再抽/缩小先执行后休息，子卡为待做；回来恢复待开始卡和待机计时；输入提醒清零拒绝但不改计时；休息回答通过新增自动覆盖段记账，覆盖可跨日；空白和零时长不补段，同一回答第三次发信号。
- deal：首页待开始卡可被新阻塞顶替，不计拒绝/跳过/排除；进行中、插入和休息不被新阻塞打断；本轮排除耗尽重新开始；主线随机权重 1.5、其他 1 的边界有确定性测试；空引导只在无候选时出现；停止出卡到 04:00 后恢复；每日底线重新计算。
- homeProjection：覆盖后的已完成历史与当前尾段分开累计，覆盖恰好延伸到当前时刻时从当前时刻继续计数；多个主线项目任意一个押注到期都会体现在回顾投影；零时长、跨日、插入、离线释放均有回归。
- bootstrap：日边界回调由空提交替换成 `dealService.refresh(ctx, ctx.now())`。

## 本轮修复与协作

新增测试实际发现四个失败：本提交修复 homeProjection 的覆盖尾段重复累计与多主线押注漏判；lead 的 `16d7182` 修复同事务两次 switchInTx 重复暂存导致 History mutation rejected，并在 scheduler 同事务串联离线落账和重新出卡。最后两项测试依赖该 lead 提交，本提交没有改动 timerService/scheduler。

lead 明确授权扩展 M1 回顾规则：跨周继续显示最近到期的回顾，新一期到期时替代旧未完成回顾。实现位于 `domain/review/schedule.ts`、`services/dealService.ts`，schema 新增 `已被取代`。`commit.ts` 新增 `tx.saveReview`，同一事务对同一回顾只写最终版本；保留 refreshInTx 的同步签名。测试覆盖 ISO 跨年、从未打开的回顾、进度保留、完成后消失、旧期替代、重复刷新幂等及同事务创建后完成。

真实 exe 冒烟另发现重启后离开中的大号读数残留 `04:07`。根因是 `scrambleDigits` 直接改 React 管理的 textContent，而 HomePage 传入空的恢复回调；卡离开后时长不变，React 不会重写相同的文本值。用真实数据重放到 seq 8 证明首个 publish 与 cardView 均为 27.715 秒（seq 5 + 7；最终 seq 9 后是 28.723 秒），不存在卡 A 的时长混入。动画旧实现的回归测试固定随机帧后失败为 `04:07`；现改用 `data-scramble` 与 CSS 伪元素，真实文本始终由 React 管理，结束和取消时删属性，effect 卸载时取消 rAF。对应 `src/app/readoutRegression.test.ts`、`src/ui/effects/reveal.test.ts`。HomePage、intro、预览调用及 marks.css 的改动均获 lead 明确授权。

## 验证

- `npm run check`：通过，28 个测试文件、146 项测试，包含 tsc 与 ESLint；日志 `evidence/m1-logic-check.txt`。测试进程沿用项目现有 60 秒硬上限，没有新增超时或降级路径。
- `git diff --check`：通过。
- `npm run tauri -- build --debug --no-bundle`：通过，普通非 verify 构建，产物 `src-tauri/target/debug/pixel-record.exe`；日志 `evidence/m1-logic-build.txt`。保留既有 Zod PURE 注释与 bundle 大小警告，没有为消除警告调整阈值。
- 真实桌面 UI 冒烟由 Claude Pro B 开始、lead 接手，证据位于 `evidence/m1-wire/`；读数修复的真实 exe 复测由 lead 在本次构建后执行，本报告不提前宣称通过。

## M3 合同与未验证项

lead 裁定：新一期回看的时间范围从上一次已完成的回顾开始，延续到现在，不能只取本周；旧期被替代不丢弃它覆盖的内容。本次仅实现周期规则、出卡和替代状态持久化，M3 回看页面、范围查询及完成时刻字段尚未实现，须在 M3 落实此合同。

真实休眠唤醒、Windows 重启自启、屏幕系统通知以及完整 M0–M1 原生冒烟清单不由本轮服务测试证明；保留首期计划中的后续验收要求。本次只暂存本人负责路径及已授权的 bootstrap/commit/schema 改动，不包含同事 UI 改动或 `evidence/journal-real.json`。
