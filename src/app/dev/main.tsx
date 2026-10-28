// 开发用预览入口（gallery.html）：?page=home|settings|parts 看设计系统，?page=card|guide|rest|review|mini 看首页部件，?page=backpack 看背包页，?page=review / settingsPage 看回顾页和设置页。
// 加 ?still 关掉动效，方便截图对照。不在 index.html 里引用，不进生产构建。
import { createRoot } from 'react-dom/client';
import { setMotionLevel } from '../../ui/effects/animate';
import { Gallery } from '../../ui/dev/Gallery';
import { HomePreview, PREVIEW_PAGES } from './HomePreview';
import { BackpackPreview } from './BackpackPreview';
import { ReviewPreview, SettingsPreview } from './M3Preview';
import '../../ui/styles/base.css';

const q = new URLSearchParams(location.search), page = q.get('page') ?? 'home';
if (q.has('still')) setMotionLevel('off');
const root = page === 'review' ? <ReviewPreview step={q.get('step') ?? 'recap'} />
  : page === 'settingsPage' ? <SettingsPreview sec={q.get('sec') ?? 'deal'} />
  : page === 'backpack' ? <BackpackPreview tab={q.get('tab') ?? 'tasks'} overlay={q.get('o')} />
  : PREVIEW_PAGES.includes(page) ? <HomePreview page={page} overlay={q.get('o')} /> : <Gallery page={page} />;
createRoot(document.getElementById('root')!).render(root);
