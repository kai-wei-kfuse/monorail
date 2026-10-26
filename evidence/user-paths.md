# 真实用户触发路径观察

2026-10-27。以下为本次 Windows 原生控制工具的观察记录，不是程序内 API 断言。

- 原生目录选择器：实际打开 dialog，在“文件夹”字段填写 `C:\Users\kai_wei\Documents\1026(4)\app\.verification-data\desktop`，实际点击“选择文件夹”。随后 config.json 指向该目录，日志出现 connected 与 journal 初始化成功。
- 全局快捷键：普通构建进程 17424，主窗口前台时实际按下 Ctrl+Alt+Shift+R。窗口列表新增标题“快速记录 · 验证骨架”（窗口 ID 658234）。从其他应用前台唤出未测。
- 失焦隐藏：记录条可见时，实际点击主窗口上的“完成”；之后窗口列表只剩主窗口，记录条隐藏。任务卡落盘状态为已完成，见 completed-card.md。
- 关闭只隐藏：实际点击主窗口标题栏右上角关闭。之后该进程的可见窗口列表为空；PowerShell 仍查到进程 17424，MainWindowTitle 为 single-instance 辅助窗口，而非任务主窗口，说明进程未退出。
- 未测：实际点托盘图标唤回、实际点击记录条保存按钮、屏幕 Toast 可见性、真实系统休眠、重启 Windows 后自启。

窗口 API 的程序内测试另见 native-verification.jsonl；不要把它混作上述真实点击路径。
