# N4 逻辑线契约与简报

2026-10-28。UI/app 未修改；Claude 按下面的投影和签名接线。

## 任务池

`snapshot.backpack.pool`（store 的 `PoolView`）可直接赋给 `pages/backpack/TaskPool.tsx` 的 `PoolView`。
包含 mains/sides（items 的全部字段、defaultProject）、parked、doneSides、mainMax/sideMax/mainItems、projects。
另有 `knownTags: string[]`、`excessSideIds: string[]`；各 PoolTask 另有 `overLimit: boolean`（主线事项超限）。
Claude：用 excessSideIds 标出 E4 超出上限的支线；仍显示全部任务。事项 running 表示实际存在未结束的卡条目，暂停/离开时为 false。
elapsedMs 按快照发布时刻计算；UI 若需要每秒刷新可重新投影（projectBackpack 的最后一个参数为当前时间），不能把它当永久累计值写回。

```ts
// services/backpackService.ts
createTask(ctx, draft: TaskDraft, at: string): Promise<string> // task id
addItem(ctx, taskId: string, content: string, at: string): Promise<string> // card id
setDefaultProject(ctx, taskId: string, project: string | null, at: string): Promise<void>
freezeTask(ctx, taskId: string, at: string): Promise<void>
abandonTask(ctx, taskId: string, at: string): Promise<void>
restoreTask(ctx, taskId: string, slot: '主线' | '支线', at: string, makeRoom?: MakeRoom): Promise<void>
saveCard(ctx, cardId: string | null, fields: CardFields, at: string): Promise<string>
```

`TaskDraft`（shared/backpack.ts）：原有 name/slot/makeRoom，加 `items?: string[]; defaultProject?: string | null`。
N4 TaskDialog 应总是传 items；空列表产生「任务本身」一项。旧表单省略 items 时继续保留空任务行为，待 Claude 完成接线后可删除这个兼容入口。
`CardFields` 加 `project?: string | null; tags?: string[]`。省略时保留原值，传 null / [] 清空；新表单应明确传值。backpack.queue[].cards[].fields 已含这两项。
Claude：更新 widgets/CardEditor、TaskDialog 并接 TaskPool。首次拆开只交 addItem：只有一个待做事项、去方括号后等于任务名且未计时，原 id 原位改为新内容；已计时则追加。
注意 TaskPool 当前在 mainItems=1 且有一个可替换事项时禁用了「拆开」；接线时允许该替换入口，服务仍校验规则。

## 想法、标签、项目

```ts
// services/ideaService.ts
convertIdeaToTask(ctx, ideaId, input: IdeaTaskInput, at): Promise<string[]> // card ids
type IdeaTaskInput = { items: string[] } & (
  { taskId: string } |
  { name: string; slot: '主线' | '支线'; defaultProject: string | null }
);
// services/backpackProjection.ts
projectBackpack(cards, tasks, records, entries, settings, at): BackpackSlice
```

旧 convertIdea 也改为创建所属任务；新入口支持多项、新建主/支线或放入已有任务，检查容量，继承想法标签，失败整笔回滚。
`home.knownTags` 和 `backpack.pool.knownTags` 都按条目、预设、卡上的使用次数降序排列，同频按名字；显式创建但未使用的标签仍保留。
`domain/timeline/project.ts` 的 projectOptions 返回系统五项、未分类和自定义项目；pool.projects 已包含它们。首页可用 pool.projects 和 home.knownTags。
记录条的标签提取已统一调用 shared/tags.ts，并修正 URL #fragment、邮箱 @ 的误识别；未改 UI。

## 验证与交接

- npm test、npm run check 通过：53 个文件、348 条测试；npm run build 通过。
- 覆盖首次拆分/已计时保留、每任务事项上限、调低上限不移出、E4 reconcile 超限、支线自动完成、冷藏/放回、事项元数据同步计时、标签排序、想法多项转换及失败回滚。
- 证据：n4-tests.log、n4-check.log、n4-build.log。
- 未实测：真实记录条在支线已满时的端到端操作、任务池 UI、收藏数字键。测试使用 MemoryFs 和真实服务，不能替代 Windows UI 冒烟。
- Claude 负责上述 UI/app 接线；用户在接线后验证 E4 和表单交互。未推送、未发版；下次发布带上 cbe1b11。
