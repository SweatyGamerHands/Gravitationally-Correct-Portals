import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const isWindowsAppLauncher =
  (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') &&
  new URLSearchParams(window.location.search).get('portalLabDesktop') === '1';

if (isWindowsAppLauncher) {
  const keepLauncherAlive = () => {
    void fetch('/__portal_lab_keepalive', {
      method: 'POST',
      cache: 'no-store',
      keepalive: true,
    }).catch(() => undefined);
  };

  keepLauncherAlive();
  window.setInterval(keepLauncherAlive, 30_000);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
