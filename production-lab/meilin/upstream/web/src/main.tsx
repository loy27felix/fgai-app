import { createRoot } from 'react-dom/client';
import App from './StudioApp';

// ?still freezes motion (used for review screenshots)
if (new URLSearchParams(location.search).has('still')) document.documentElement.classList.add('still');

createRoot(document.getElementById('root')!).render(<App />);
