import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallbackTitle="Đã xảy ra sự cố khi tải Bơ Film Avocado Cinema">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// PWA Service Worker Registration & Live Cache Busting
if (typeof window !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  // Auto reload when new service worker takes control (instant update)
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Check for updates on every page load
        reg.update().catch(() => {});
      })
      .catch((err) => {
        console.warn('PWA service worker registration failed:', err);
      });
  });

  // Global cache purger utility
  (window as unknown as { bofilmResetCache: () => Promise<void> }).bofilmResetCache = async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) {
        await reg.unregister();
      }
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
      }
    }
    window.location.reload();
  };
}
