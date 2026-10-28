export const SYSTEM_PROJECTS = ['待机', '休息', '睡眠', '离线', '回顾'] as const;
export interface Project { name: string; color: string }

export function newProject(projects: readonly Project[], input: string): Project {
  const name = input.trim();
  if (!name) throw new Error('项目名不能为空');
  if (name === '未分类' || SYSTEM_PROJECTS.some(item => item === name) || projects.some(item => item.name === name)) throw new Error('项目名已经存在或由系统保留');
  const used = new Set(projects.map(item => item.color.toLowerCase()));
  // An odd stride visits every RGB value once. The bound is the actual 24-bit colour space.
  const colors = 0x1000000;
  for (let index = 0; index < colors; index++) {
    const color = `#${((0x5294d6 + index * 0x9e3779) % colors).toString(16).padStart(6, '0')}`;
    if (!used.has(color)) return { name, color };
  }
  throw new Error('所有 RGB 颜色均已使用');
}
