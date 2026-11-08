// 想法文档独立窗口入口（idea.html）：只接收主窗口快照与回执、只经协议请求主窗口单写入者提交，不能在这里 bootstrap 或建 Ctx（ADR 0028）。
import { createRoot } from 'react-dom/client';
import { IdeaWindowApp } from './app/IdeaWindowApp';
import './ui/styles/base.css';

createRoot(document.getElementById('root')!).render(<IdeaWindowApp />);
