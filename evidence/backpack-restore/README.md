# 背包页：放回背包选格 + 去掉卡片编辑器重复的清除按钮（任务 01a17c4c）

截图来自 `npm run dev` 的 `/gallery.html?still&page=backpack…`，用无头 Edge（`--disable-extensions`，CDP 9333）截取，没有启动 exe。

| 文件 | 内容 |
|---|---|
| 01-restore-side-free.png | 主线满、支线有空：「主线格」置灰并标「满了」，默认选支线格，按钮「放回」 |
| 02-restore-both-full.png | 两格都满（`&full`）：两格都能选，下面出现腾位列表；没选之前「腾出位置并放回」不可点 |
| 03-restore-both-full-picked.png | 选了「冷藏『小游戏房间系统』」以后按钮可点 |
| 04-card-editor-due.png | 卡片编辑器的期限：只剩新控件里的 ×，原来的「清除」按钮删掉了 |

- `BackpackActions.restoreProject` 改为 `(id: string, slot: BackpackSlot, at: string, makeRoom?: MakeRoom) => void`，类型来自 `shared/backpack`，和 `backpackService.restoreProject(ctx, id, slot, at, makeRoom?)` 一一对应。`at` 取的是对话框里点「放回」的时间。
- 新增 `RestoreDialog`，放在 `widgets/ProjectDialog.tsx` 里，和新建项目共用 `MakeRoomPicker`。widgets 之间不能互相引用，所以放在同一个文件里。
- 「放回背包」按钮不再因为满格而禁用：满了就在对话框里腾位。
- 预览：`BackpackPreview` 新增 `?o=restore` 和 `&full`（支线 1 格，让两格都满）。
