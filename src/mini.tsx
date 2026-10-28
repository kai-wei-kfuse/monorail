// 小窗入口（mini.html）：独立窗口，只接收主窗口的快照、只发命令。不能在这里 bootstrap 或建 Ctx（N6 接线草案）。
import { createRoot } from 'react-dom/client';
import { MiniApp } from './app/MiniApp';
import './ui/styles/base.css';

createRoot(document.getElementById('root')!).render(<MiniApp />);
