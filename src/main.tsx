import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

// Outside Tauri the transparent body has nothing behind it; flag the document
// so the stylesheet can paint a stand-in background for browser previews.
if (!('__TAURI_INTERNALS__' in window)) {
  document.documentElement.setAttribute('data-web', '');
}

// The webview's own context menu and drag-to-navigate feel wrong in a native
// window, so suppress them.
window.addEventListener('contextmenu', (e) => {
  const target = e.target as HTMLElement;
  const editable = target.closest('input, textarea, [contenteditable]');
  if (!editable) e.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
