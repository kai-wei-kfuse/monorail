import { createRoot } from 'react-dom/client';
import { setMotionLevel } from '../effects/animate';
import { Gallery } from './Gallery';
import '../styles/base.css';

const q = new URLSearchParams(location.search);
if (q.has('still')) setMotionLevel('off');
createRoot(document.getElementById('root')!).render(<Gallery page={q.get('page') ?? 'home'} />);
