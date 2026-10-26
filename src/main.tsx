import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { MainApp } from './app/MainApp';
import { QuickBarApp } from './app/QuickBarApp';

createRoot(document.getElementById('root')!).render(getCurrentWindow().label === 'quickbar' ? <QuickBarApp /> : <MainApp />);
