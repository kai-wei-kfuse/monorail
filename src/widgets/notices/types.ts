// 提示的类型定义在 shared/notices.ts（store 也要用，不能依赖 widgets）。这里转出，方便提示组件就近引用。
export type { ActivityOption, BackfillResult, Notice, NoticeData, NoticeKind, NoticeProps, NoticeResult } from '../../shared/notices';
export { now } from '../../shared/notices';
