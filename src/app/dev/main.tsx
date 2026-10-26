// 开发用预览入口（gallery.html）：?page=home|settings|parts 看设计系统，?page=card|guide|rest|review|mini 看首页部件。
// 加 ?still 关掉动效，方便截图对照。不在 index.html 里引用，不进生产构建。
import { createRoot } from 'react-dom/client';
import { setMotionLevel } from '../../ui/effects/animate';
import { Gallery } from '../../ui/dev/Gallery';
import { HomePreview, PREVIEW_PAGES } from './HomePreview';
import '../../ui/styles/base.css';

const q = new URLSearchParams(location.search), page = q.get('page') ?? 'home';
if (q.has('still')) setMotionLevel('off');
createRoot(document.getElementById('root')!).render(PREVIEW_PAGES.includes(page) ? <HomePreview page={page} /> : <Gallery page={page} />);
