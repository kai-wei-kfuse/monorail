# ADR 0007：实体仓库（MdRepo）磁盘快照解析缓存与平台文件层本地路径解析

- 状态：Accepted（v1.2：coder 接手完成实现、审核及原生性能验证）
- 日期：2026-11-01
- 生效版本：0.2.5
- 依据：用户在 0.2.5 隔离手测中反馈点击快捷活动存在明显延迟；经源码核查与 [首审记录](../../evidence/0.2.5-quickacts-latency-plan-review.md)，除移除 `QuickActs.tsx` 硬编码 `650ms` 关窗定时器外，需在保持现有架构分层、外部修改检测（`mtime` / `Journal.before`）与崩溃恢复语义不变的前提下，消除 `tauriFs` 路径拼接的跨进程 IPC 往返、并行化 `MdRepo.list()` 文件读取，并为 `MdRepo` 引入基于真实磁盘 `(version, text)` 快照的受控解析缓存。

## 问题与背景

在当前数据层（`src/data/fs.ts`、`src/data/mdRepo.ts`、`src/services/commit.ts`）中：

1. **每次事务提交前重读四类实体目录**：`commit.ts:97` 在进入业务回调前通过 `Promise.all([cards.list(), tasks.list(), reviews.list(), records.list()])` 并行加载四类实体。虽然四个目录之间已并行，但每个 `MdRepo.list()` 内部使用 `for ... await` 逐文件串行调用 `get(id)`，且每次不论文件是否变化都重新执行 `frontmatter.decode`（YAML 解析）与 `this.schema.parse`（Zod 校验）。
2. **`tauriFs` 每次路径拼接与父目录提取均触发跨进程 IPC**：`@tauri-apps/api/path` 的 `join` 与 `dirname` 在 Tauri 2 中均通过 `invoke('plugin:path|...')` 跨进程调用原生端。因此读取单个已存在文件需串行经历 `join` -> `exists` -> `stat` -> `readTextFile` 共 **4 次 IPC 调用、4 个串行等待阶段**；`atomicWrite` 也需先经 `join` 与 `dirname` 两次 IPC。

若直接在 store 中使用未提交状态乐观渲染，或让 `MdRepo` 跳过磁盘读取直接返回内存缓存，会违反 `CLAUDE.md` 的核心约束（所有写操作必须走「动作 -> 服务 -> 落盘 -> 更新 store」，以及保留 `MdRepo` 在外部修改文件时感知 `mtime` 变化的能力）。因此需要明确定义低层路径处理与缓存的边界契约。

## 决定

### 1. `tauriFs` 本地路径解析契约与读阶段合并（`src/data/fs.ts`）

仅在 `src/data/fs.ts` 内提取当前数据层所需的窄范围本地路径辅助函数（`splitRoot`、`resolveLocal`、`parentLocal`），替代 `@tauri-apps/api/path` 的 `join` 与 `dirname` IPC 调用，不引入通用路径框架，也不静默回退到原生 IPC：

1. **输入边界（`safeRelative` 保持不变）**：
   - 所有业务相对路径必须先通过 `safeRelative(path)` 校验：拒绝空字符串 `''`、以 `/` 开头、包含 `\` 或 `:`、或含 `.` / `..` 路径段的字符串。
   - `list(directory, recursive)` 中当 `directory === ''` 时直接使用已验证的绝对 `root`；递归子目录时对 `entry.name` 同样经 `safeRelative(entry.name)` 校验后拼接。
2. **Windows 与 POSIX 根目录语义保留（`splitRoot`）**：
   - `splitRoot(rawPath)` 提取路径的绝对根前缀 `root`、剩余路径段 `rest` 与分隔符 `sep`（含 `\` 时取 `\`，否则取 `/`）：
     - **扩展 UNC 根**（`\\?\UNC\server\share` 或 `\\.\UNC\server\share`）：`root` 保留 `\\?\UNC\server\share`（统一为 `sep`）；
     - **扩展盘符根**（`\\?\C:` 或 `\\.\C:`）：`root` **必须保留尾部分隔符**（如 `\\?\C:\`），绝不退化为非法的 `\\?\C:`；
     - **标准 UNC 共享根**（`\\server\share`）：`root` 保留 `\\server\share`（统一为 `sep`）；
     - **标准 Windows 盘符根**（`C:\`、`C:/`）：`root` 必须保留尾部分隔符；`C:` 和 `C:relative` 本身是盘符相对路径，不得默默解释成绝对根。数据目录沿用 save_config 的绝对路径契约，不支持的相对根显式报错；
     - **其他扩展卷前缀**（如 `\\?\Volume{...}\`）：保留命名空间前缀与分隔符，避免合法的无盘符卷路径在本地拼接时丢失开头；
     - **POSIX 绝对根**（`/…`）：`root` 为 `'/'`。
   - `resolveLocal(baseRoot, relative)` 将 `baseRoot` 的 `rest` 段与 `safeRelative(relative)` 的 `/` 分段合并后拼接到 `root` 之后；
   - `parentLocal(fullPath)` 将 `fullPath` 的 `rest` 段弹出最后一段后拼接到 `root` 之后；当文件直接位于根目录下（弹出后 `segments` 为空）时直接返回 `root`（如 `parentLocal('C:\\settings.yaml') === 'C:\\'`、`parentLocal('\\\\?\\C:\\settings.yaml') === '\\\\?\\C:\\'`）。
3. **单文件读取 IPC 阶段合并与非原子快照说明**：
   - `tauriFs.read(path)` 本地计算出 `full = resolveLocal(root, path)` 后，先执行 `if (!await fs.exists(full)) return null;`，随后并行执行 `const [info, text] = await Promise.all([fs.stat(full), fs.readTextFile(full)]);`。
   - 这样对已存在文件的单次读取由 **4 次 IPC / 4 个串行阶段** 降为 **3 次 IPC（`exists`、`stat`、`readTextFile`）/ 2 个依赖阶段**。
   - **取舍声明**：`stat` 与 `readTextFile` 并行执行并非操作系统级原子文件快照；原串行实现同样不具备原子快照保证。本变更不声称提供比原实现更强的并发外部编辑隔离，仍依靠 `version`（`${info.mtime?.getTime()}:${info.size}`）与 `Journal` 提交前的 `before` 原文比对检测外部修改。若文件在 `exists` 之后、`stat`/`readTextFile` 完成前被外部删除或任一 IPC 报错，Promise 直接按原样抛出错误，不静默吞掉。

### 2. `MdRepo` 并行列表与磁盘快照解析缓存契约（`src/data/mdRepo.ts`）

每个 `MdRepo<T>` 实例（构造时固定绑定单一 `directory` 与单一 `schema: z.ZodType<T>`）维护实例级内存映射 `private cache = new Map<string, Entity<T>>()`，严格遵守以下 5 条不变量：

1. **不变量 1（磁盘始终是唯一事实源，每次必读盘）**：
   - `get(id)` 每次调用**必须**先执行 `const file = await this.fs.read(path)` 获取磁盘当前的 `version` 与 `text`。缓存仅在磁盘真实读取返回非空且 `cached.version === file.version && cached.text === file.text` 时跳过 `decode(file.text, path)` 与 `this.schema.parse(parsed.meta)`，绝不跳过 `this.fs.read(path)`，绝不成为第二个存储来源。
2. **不变量 2（首次解析返回值与后续缓存命中返回值双重深拷贝隔离）**：
   - 实体 schema 允许通过 `.passthrough()` 携带任意嵌套未知对象或数组。
   - **首次解析（未命中或失效重解析）时**：解析结果由当前调用方独占，缓存存入 structuredClone(value) 的独立副本；对外可直接返回本次新解析的 value，避免再做一次没有隔离收益的克隆。两者没有共享可变字段。
   - **缓存命中时**：对外返回 `{ ...cached, value: structuredClone(cached.value) }`。
   - 无论调用方修改首次 `get`/`list` 返回的嵌套字段，还是修改后续命中返回的嵌套字段，都绝不会污染 `this.cache` 内部状态。
3. **不变量 3（缺失与删除清理）**：
   - 在 `get(id)` 中，若 `await this.fs.read(path)` 返回 `null`，立即执行 `this.cache.delete(id)` 并返回 `null`。
   - 在 `list()` 中，获取当前目录 `.md` 路径列表后，先清理 `this.cache` 中已不在当前目录列表内的陈旧 `id`；再通过 `Promise.all(paths.map(...))` 并行调用 `this.get(id)`（保持 `this.fs.list` 的排序顺序）。若任一文件在枚举后消失（`!entity`），立即清理该 `id` 缓存并按原契约抛出 `Entity disappeared: ${path}`（不使用 `Promise.allSettled` 吞掉错误，也不返回部分列表）。
4. **不变量 4（只缓存成功快照，错误原样传播）**：
   - 只有当 `this.fs.read(path)`、`decode(file.text, path)` 与 `this.schema.parse(parsed.meta)` 全部成功时才写入 `this.cache`。
   - 若 `decode` 或 `this.schema.parse` 抛出异常（如外部改坏文件），先执行 `this.cache.delete(id)` 再按原格式抛出错误，绝不回退返回旧缓存。若 `this.fs.read(path)` 自身抛出 I/O 错误，同样直接抛出，不返回旧缓存。
5. **不变量 5（未提交 `Write` 不得预写缓存，保持外部修改与 Journal 校验）**：
   - `write(value, original, body)` 与 `remove(original)` 只负责重读当前磁盘校验 `mtime`（`(current?.version ?? null) !== (original?.version ?? null)`）并生成待提交的 `Write` 对象，**不得**在 `write`/`remove` 中提前修改或预填 `this.cache`。
   - 若生成的 `Write` 未送入 `Journal.run` 或 `Journal.run` 中途失败，后续 `get`/`list` 仍以真实磁盘内容为准。`Journal` 的 `before` 文本比对与崩溃恢复逻辑一行不改。

### 3. `TimelogV2Repo.writes()` 局部分组优化边界（`src/data/timelogV2Repo.ts`）

- 在 `TimelogV2Repo.writes(entries, now, boundaryHour)` 中，将按活动日分组的 `groups.set(day, [...(groups.get(day) ?? []), entry])` 改为向局部新建数组 `push(entry)`：
  - 仅修改 `writes()` 本次调用内新建的局部 `groups` `Map` 及其桶数组；
  - 不修改传入的 `entries` 或其元素，不提前修改已提交索引 `this.index`（`this.index` 仍仅在 `Journal.run` 成功后由 `acceptCommitted` 更新）；
  - 保持条目顺序与逐日 `JSON.stringify(beforeEntries) === JSON.stringify(next)` 差量写入逻辑不变。

## 验证与证据要求

1. **路径辅助函数验证**：[quickacts-path-v2-check.mjs](../../evidence/quickacts-path-v2-check.mjs) 对照 Windows 盘符根（`C:\`、`C:/`）、普通目录、尾分隔符、Unicode/空格、UNC 共享根（`\\server\share\`）、扩展盘符根（`\\?\C:\`）、扩展 UNC 根（`\\?\UNC\server\share\`）、POSIX 根及非法相对路径，全部 42 项路径对照与非法输入拦截退出码为 `0`（见 [0.2.5-quickacts-path-v2-check.log](../../evidence/0.2.5-quickacts-path-v2-check.log)）。
2. **单元测试矩阵**：在 `src/data/fs.test.ts`、`src/data/mdRepo.test.ts`、`src/data/timelogV2Repo.test.ts` 中覆盖上述全部边界与不变量。
3. **分阶段耗时基线与对比**：区分 `QuickActs.tsx` 移除 `650ms` 定时器与真实事务耗时。已在独立隐藏 Tauri 中完成 24 次真实 IPC 事务，记录排队、读盘/解析、写计划、Journal、投影至 publish 及总耗时；18/180 实体热轮次中位总耗时为 347.9→207.2ms / 1942.4→767.8ms。UI DOM 回归另测事件语义；publish 后屏幕绘制与用户数据集端到端延迟未测，不把提交时间等同于可见帧时间。详见 [最终审核](../../evidence/0.2.5-p2d-review.md)。

## Revision History

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-11-01 | 按 `0.2.5-quickacts-latency-plan-review.md` 首审要求创建 ADR 0007，明确 Windows 根路径语义、IPC 阶段计数、`MdRepo` 缓存 5 条不变量、非原子快照说明与分阶段性能测量契约 |
| v1.1 | 2026-11-01 | 主代理复审通过并按用户指示接手实现；明确相对根不转绝对根、保留扩展卷前缀、首次返回采用“调用方独占解析值 + 缓存独立克隆”以避免重复分配；初步单测 451 项及类型/lint 通过，性能证据待执行 |
| v1.2 | 2026-11-01 | 实现/独立审核/451 项测试及原生 IPC 对照完成；记录提交耗时与可见帧延迟的实际测量边界，校正 list 空目录直接使用已验证根的措辞 |
