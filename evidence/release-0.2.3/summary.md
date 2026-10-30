# 0.2.3 发布前验证

## 范围

小小窗口、尺寸和任务栏避让、透明就地编辑、快速记录条显隐及直接入口、日历比例，以及审核发现的读数覆盖确认和窗口高度适配问题。

版本由 `scripts/version.mjs` 同步为 0.2.3，schemaVersion 未改变。旧设置的 miniMode 默认值兼容由自动测试覆盖。

## 自动检查与构建

- `npm run check`：60 个测试文件、405 个用例通过，含 TypeScript 和 ESLint，见 `check.log`。
- 日历定向测试：20 个用例通过，含缩放前后视口中心换算的新回归。
- 独立 identifier 的 Windows debug 构建通过，见 `build-isolated.log`。未启用 verify feature，VITE_VERIFY=false。
- 原生窗口显隐和缩放钩子未在本次审核修复中修改；此前 7 个窗口测试及 4 个小窗测试通过，相关交互已经在本轮开发中实测。

## 隔离 Windows 冒烟

仅使用临时隔离数据 `monorail-isolated-8b5ded1c8a60/data`，未操作正式数据目录。

| 项目 | 结果与证据 |
|---|---|
| 日历 4× 缩回 1× 的视口中心 | 发布前复验确认旧实现跳到上午；修复为使用滚动事件记录的旧偏移，复验保持原中心时刻。见 ui/calendar-before-fix.jpg、calendar-4x-before-shrink.jpg、calendar-1x-center-preserved.jpg |
| 离开日历后重新进入 | 保留 4× 比例，见 ui/calendar-scale-remembered.jpg |
| 小小窗口恢复宽度 | 恢复用户保存的 339px 客户区宽度，截图含边缘为 341×48，没有重置为 320，见 ui/mini-restored-width.jpg |
| 快速记录条重复打开 | 真实快捷键打开，切回主窗口自动隐藏，再按同一快捷键可再次打开，见 ui/quickbar-reopened.jpg |
| 待机/待确认改时间的覆盖预览 | 自动测试验证重叠先确认；本次发布前未再手工操作此写入路径 |
| Ctrl＋滚轮累积换档 | 代码审查；本次 Windows 冒烟使用比例按钮，未单独实测滚轮 |
| 安装覆盖升级 | 用户此前明确自行更新；本次未安装或覆盖正式应用 |
| 架构设计其余未改动冒烟项 | 本次未重复执行，不作为新验证结论 |

命令式浏览器检查被自动审批拦截，浏览器连接服务也不可用，因此使用 computer-use 操作独立 Windows 测试应用完成上述界面复验。

## 发布

待完成签名 CI、Release 资产和更新清单核验后，另记发布结果。
