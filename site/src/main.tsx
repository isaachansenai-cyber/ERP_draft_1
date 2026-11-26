import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// Fonts are served by the site itself (latin subset only), so visitors' browsers
// never contact a third-party font host (ADR 0045).
import '@fontsource/playfair-display/latin-700.css';
import '@fontsource/playfair-display/latin-900.css';
import '@fontsource/source-sans-3/latin-400.css';
import '@fontsource/source-sans-3/latin-600.css';
import '@fontsource/source-sans-3/latin-700.css';
import './index.css';

// Links from before real page addresses (/#/menu) still work: move the hash
// route into the path before the app reads it.
if (window.location.hash.startsWith('#/')) {
  window.history.replaceState(null, '', window.location.hash.slice(1));
}

// The pre-rendered page is replaced, not hydrated: what a visitor sees first
// depends on their saved location and cart, which the build cannot know.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
