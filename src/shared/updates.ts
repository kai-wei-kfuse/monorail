export interface UpdateRelease { version: string; notes: string | null }
export type UpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'verifying' | 'ready' | 'preparing' | 'installing';
export type UpdateStep = 'idle' | 'credentials' | 'github' | 'release' | 'manifest' | 'download' | 'signature' | 'commits' | 'draft' | 'lifecycle' | 'installer' | 'current' | 'available' | 'ready';
export interface UpdateState {
  revision: number;
  currentVersion: string;
  phase: UpdatePhase;
  busy: boolean;
  step: UpdateStep;
  downloaded: number;
  total: number | null;
  release: UpdateRelease | null;
  history: { step: UpdateStep; at: number }[];
  updatedAt: number;
  error: { message: string; step: UpdateStep; at: number } | null;
}

export const updatePhaseLabels: Record<UpdatePhase, string> = {
  idle: '等待检查', checking: '检查中', current: '已是最新版本', available: '发现新版本',
  downloading: '下载中', verifying: '验证中', ready: '可以安装', preparing: '安装准备中', installing: '安装中',
};
export const updateStepLabels: Record<UpdateStep, string> = {
  idle: '点击检查更新以获取新版本', credentials: '读取本机 GitHub 登录', github: '连接 GitHub 并查询发布版本',
  release: '读取发布版本信息', manifest: '读取并校验更新清单', download: '下载新版安装包',
  signature: '验证安装包签名', commits: '等待当前保存完成', draft: '检查快速记录条的未保存内容',
  lifecycle: '保存计时状态', installer: '启动安装器并退出当前版本',
  current: '检查完成，当前已是最新版本', available: '检查完成，可以下载新版本', ready: '下载完成，签名验证通过',
};
