// ============================================================================
// main.js — entry point. Wires the app shell, then hands off to Auth.
// ============================================================================

import { Auth } from './auth.js';
import { Courier } from './pages/courier.js';
import { hideModal } from './ui.js';

// Quiet global error surface — no blocking alert() dialogs in production.
window.addEventListener('error', (e) => console.error('[app error]', e.message, e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => console.error('[unhandled rejection]', e.reason));

document.addEventListener('DOMContentLoaded', () => {
  // Service worker.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW register:', err));
  }

  // Top nav (mobile drawer).
  const navMenu = document.getElementById('nav-menu');
  const navToggle = document.getElementById('nav-toggle');
  navToggle?.addEventListener('click', () => {
    const open = navMenu.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (navMenu?.classList.contains('open') && !navMenu.contains(e.target) && !navToggle.contains(e.target)) {
      navMenu.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    }
  });

  // Logout.
  document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

  // Modal close.
  document.getElementById('btn-modal-close').addEventListener('click', hideModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') hideModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    hideModal();
    document.getElementById('edit-courier-modal')?.classList.remove('show');
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
