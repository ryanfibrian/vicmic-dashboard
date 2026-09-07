// ============================================================================
// main.js — entry point. Wires the app shell, then hands off to Auth.
// ============================================================================

import { Auth } from './auth.js';
import { Courier } from './pages/courier.js';
import { hideModal } from './ui.js';
import { initThemeEarly, wireThemeToggles } from './theme.js';

initThemeEarly();

// Quiet global error surface — no blocking alert() dialogs in production.
window.addEventListener('error', (e) => console.error('[app error]', e.message, e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => console.error('[unhandled rejection]', e.reason));

document.addEventListener('DOMContentLoaded', () => {
  wireThemeToggles();

  // Service worker.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW register:', err));
  }

  // Sidebar (mobile).
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  document.getElementById('mobile-menu-toggle').addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
  });
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  });

  // Logout.
  document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

  // Modal close.
  document.getElementById('btn-modal-close').addEventListener('click', hideModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') hideModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideModal();
  });

  // Collapsible cards on mobile.
  document.querySelectorAll('.mobile-collapsible').forEach((header) => {
    header.addEventListener('click', (e) => {
      if (window.innerWidth > 768) return;
      if (['select', 'option', 'input', 'button'].includes(e.target.tagName.toLowerCase())) return;
      header.classList.toggle('collapsed');
    });
  });

  Courier.init();
  Auth.init();
});
