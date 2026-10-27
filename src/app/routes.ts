// 页面注册表（架构 §3.1）：标题栏的页面标签由它生成。ready 为 false 的页面还没接线，不显示标签。
// 背包 M2、回顾和设置 M3 接线时，把 ready 改成 true，并在 MainApp 里接上对应页面。以后加笔记页也只在这里登记一项（架构 §7）。

export interface Route { id: 'home' | 'backpack' | 'review' | 'settings'; cn: string; en: string; ready: boolean }

export const ROUTES: Route[] = [
  { id: 'home', cn: '首页', en: 'HOME', ready: true },
  { id: 'backpack', cn: '背包', en: 'BACKPACK', ready: true },
  { id: 'review', cn: '回顾', en: 'REVIEW', ready: false },
  { id: 'settings', cn: '设置', en: 'SETTINGS', ready: true },
];

export const readyRoutes = () => ROUTES.filter(r => r.ready);
