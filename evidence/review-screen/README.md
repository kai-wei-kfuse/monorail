# M3 接线：回顾页 ReviewScreen（任务 01a17c5c）

截图来自 gallery 的回顾页预览（`?page=review&step=…`），用无头 Edge（`--disable-extensions`）截取，没有启动 exe。预览用的是假数据，没有连 service；ReviewScreen 本身的接线只经过了 tsc 和 eslint，没有实机验证。

| 文件 | 内容 |
|---|---|
| 01-bet-step.png | 主线复盘这一步 |
| 02-switch-main-dialog.png | 「换一条主线」：新建项目，或者放回冷藏的项目（预览里没有冷藏项目，所以置灰并标「没有」）；旧主线选冷藏或放弃 |
| 03-coldpick-step.png | 冷库捞取（没有待决对决）：只有 ColdPick 自己的「都不要 / 带回」，没有通用的页脚 |

## 接线（app/ReviewScreen.tsx，props `{ ctx, report }`）

- 挂载时调用一次 `reviewService.enter(ctx, at)`，完成之前显示「正在打开回顾…」。卸载或隐藏时什么都不调用，回顾计时不会停。
- 进入之后 `store.review === null`，显示「本期回顾已完成」的空状态。
- `takeCold(ctx, ids, at, confirmed)`：池满时 ColdPick 已经弹过「捞回并对决」的确认，所以 `confirmed` 取 `poolFree <= 0`。
- 冷库对决：步骤仍是 coldPick，页面用 `store.review.duel` 显示 Arena，下面有「不捞了」（skipCold）。冷库对决和普通超额配对的区分方法：对决双方里有一个还在 `cold.offered` 里。
- ColdPick 的「都不要」，以及冷库是空的时候的「下一步」，都改成调用 `skipCold`，由 service 决定是进入主线复盘还是结束回顾，不再走 `goto`/`finish`。
- `switchMain`：新建时传 `{ name, slot: '主线', makeRoom: { id: 旧主线, action } }`；放回时传 `{ restoreId, makeRoom }`。旧主线的 id 是在 `backpack.inBackpack` 里按名字找到的，因为复盘数据里只有名字。冷藏项目的列表取自 `store.backpack.projects`。
- 出错一律交给 `report`。

## 页面调整（pages/review）

- 新增 `SwitchMain.tsx`，替换原来的 ProjectDialog(setMain)。
- `ReviewActions.switchMain` 的参数改成 `ProjectDraft | { restoreId, makeRoom }`。
- `ReviewData.backpack.inBackpack` 的 `slotIndex` 改成可选，store 里的数据没有这个字段。
- `ReviewPage` 新增可选 prop `parked`。
- BetReview 在找不到旧主线时，「换一条主线」置灰。

## 建议

- `ReviewData.bet` 最好直接带上项目 id。现在页面要按名字去找，两条主线同名时会认错。
