// 页面注册表（架构 §3.1）：标题栏的页面标签由它生成。ready 为 false 的页面还没接线，不显示标签。
// 0.3.1 去掉「背包」标签：背包是首页底栏拉开的抽屉（ADR 0021 第 2 条）。以后加笔记页也只在这里登记一项（架构 §7）。

export interface Route { id: 'home' | 'calendar' | 'list' | 'review' | 'settings'; cn: string; en: string; ready: boolean }

export const ROUTES: Route[] = [
  { id: 'home', cn: '首页', en: 'HOME', ready: true },
  { id: 'calendar', cn: '日历', en: 'CALENDAR', ready: true },
  { id: 'list', cn: '列表', en: 'LIST', ready: true },
  { id: 'review', cn: '回顾', en: 'REVIEW', ready: true },
  { id: 'settings', cn: '设置', en: 'SETTINGS', ready: true },
];

export const readyRoutes = () => ROUTES.filter(r => r.ready);
