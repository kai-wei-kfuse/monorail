import { ProjectPicker } from '../../ui/controls/ProjectPicker';
import type { ActivityOption, ProjectChoice } from './types';
import './notices.css';

/**
 * 追问对话框里的项目选择（离线追问、空闲追问共用）：可以选任意项目；选快捷活动时自动填它的项目，之后还能改。
 * 手写的活动缺省「未分类」（用户 2026-11-06：不再一律记成「生活」）。旧通知没有 projects 时只给「未分类」。
 */
export function askProjectFor(activity: string, options: ActivityOption[], picked: string | null): string {
  if (picked !== null) return picked;
  return options.find(o => o.id === activity)?.project ?? '未分类';
}
export function AskProject({ value, projects, onChange }: { value: string; projects?: ProjectChoice[]; onChange: (name: string) => void }) {
  const options = projects?.length ? projects : [{ name: '未分类', color: '#888884' }];
  return <div className="nt-field">
    <span>项目</span>
    <ProjectPicker id="ask-project" value={value} options={options} onChange={onChange} />
  </div>;
}
