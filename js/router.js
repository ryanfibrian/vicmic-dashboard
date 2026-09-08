// ============================================================================
// router.js — hash-based page switching with per-role access guards.
// ============================================================================

import { Auth } from './auth.js';
import { Dashboard } from './pages/dashboard.js';
import { PriceList } from './pages/pricelist.js';
import { UserManagement } from './pages/users.js';
import { Upload } from './pages/upload.js';
import { Settings } from './pages/settings.js';
import { Courier } from './pages/courier.js';

const ACCESS = {
  admin: ['dashboard', 'pricelist', 'users', 'upload', 'settings', 'courier'],
  sales: ['dashboard', 'pricelist'],
  sales_kurir: ['dashboard', 'pricelist', 'courier'],
};

export const Router = {
  currentPage: null,
  _initialized: false,

  init() {
    if (!this._initialized) {
      window.addEventListener('hashchange', () => this.handleRoute());
      document.querySelectorAll('.nav-item').forEach((item) => {
        item.addEventListener('click', () => {
          window.location.hash = item.dataset.page;
          closeNav();
        });
      });
      this._initialized = true;
    }

    const home = Auth.isAdmin() ? 'dashboard' : 'pricelist';
    if (window.location.hash && window.location.hash !== '#') this.handleRoute();
    else window.location.hash = home;
  },

  allowedPages() {
    return ACCESS[Auth.currentUser?.role] || ['pricelist'];
  },

  handleRoute() {
    const allowed = this.allowedPages();
    let page = window.location.hash.replace('#', '') || allowed[0];
    if (!allowed.includes(page)) {
      window.location.hash = allowed[0];
      return;
    }

    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    const target = document.getElementById('page-' + page);
    if (!target) return;

    target.classList.add('active');
    this.currentPage = page;
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.page === page);
    });
    this.renderPage(page);
  },

  async renderPage(page) {
    try {
      switch (page) {
        case 'dashboard': return void (await Dashboard.render());
        case 'pricelist': return void (await PriceList.render());
        case 'users': return void (await UserManagement.render());
        case 'upload': return void (await Upload.render());
        case 'settings': return void (await Settings.render());
        case 'courier': return void (Auth.isKurir() && (await Courier.loadLogs()));
      }
    } catch (e) {
      console.error(`renderPage(${page}):`, e);
    }
  },
};

function closeNav() {
  const menu = document.getElementById('nav-menu');
  menu?.classList.remove('open');
  document.getElementById('nav-toggle')?.setAttribute('aria-expanded', 'false');
}
