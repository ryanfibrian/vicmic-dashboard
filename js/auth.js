// ============================================================================
// auth.js — Google login via Supabase Auth, session handling, role gating.
//
// The browser gets a Google ID token from Google Identity Services, then hands
// it to supabase.auth.signInWithIdToken(). Supabase verifies it and issues a
// real JWT (with the verified email) that RLS policies check. The old flow only
// decoded the token client-side and trusted a localStorage blob.
// ============================================================================

import { supabaseClient, CONFIG, IS_LOCALHOST } from './config.js';
import { DB } from './db.js';
import { PriceCalc } from './priceCalc.js';
import { Router } from './router.js';
import { showToast } from './ui.js';

const SESSION_HINT_KEY = 'vicmic_role_hint'; // first-paint only, never trusted

export const Auth = {
  currentUser: null,
  _wired: false,

  async init() {
    this._wireAuthListener();

    const { data } = await supabaseClient.auth.getSession();
    if (data?.session) {
      const ok = await this._adoptSession(data.session);
      if (ok) return;
    }

    this.showLoginPage();
    this._waitForGoogle();
  },

  _wireAuthListener() {
    if (this._wired) return;
    this._wired = true;
    supabaseClient.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && this.currentUser) {
        this._resetToLogin();
      }
    });
  },

  // Turn a Supabase session into this.currentUser (role from allowed_users).
  async _adoptSession(session) {
    const email = (session.user?.email || '').toLowerCase();
    if (!email) return false;

    const meta = session.user.user_metadata || {};
    const user = await DB.findUser(email);
    if (!user) {
      await supabaseClient.auth.signOut();
      this._showLoginError('Email Anda belum terdaftar. Hubungi Admin.');
      showToast('Akses ditolak: email belum di-whitelist', 'error');
      return false;
    }

    this.currentUser = {
      email,
      name: meta.full_name || meta.name || email.split('@')[0],
      picture: meta.avatar_url || meta.picture || '',
      role: user.role,
      isSuperAdmin: user.isSuperAdmin || false,
    };
    try {
      localStorage.setItem(SESSION_HINT_KEY, user.role);
    } catch {}
    await this.onLoginSuccess();
    return true;
  },

  // ---- Google Identity Services -------------------------------------
  _waitForGoogle() {
    let attempts = 0;
    const tryInit = () => {
      if (window.google?.accounts?.id) {
        this._initGoogleSignIn();
      } else if (attempts < 40) {
        attempts += 1;
        setTimeout(tryInit, 100);
      } else if (IS_LOCALHOST) {
        this._setupDemoLogin();
      } else {
        this._showLoginError('Gagal memuat Google Sign-In. Periksa koneksi lalu muat ulang.');
      }
    };
    tryInit();
  },

  _initGoogleSignIn() {
    const container = document.getElementById('google-signin-btn');
    container.innerHTML = ''; // clear any button from a previous login cycle
    try {
      google.accounts.id.initialize({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        callback: (res) => this._handleCredential(res),
        auto_select: false,
      });
      google.accounts.id.renderButton(container, {
        theme: 'filled_blue',
        size: 'large',
        width: 300,
        text: 'signin_with',
        shape: 'rectangular',
      });
      if (IS_LOCALHOST) this._appendDemoSwitch(container);
    } catch (e) {
      console.warn('Google init failed:', e);
      if (IS_LOCALHOST) this._setupDemoLogin();
      else this._showLoginError('Google Sign-In gagal diinisialisasi.');
    }
  },

  async _handleCredential(res) {
    this._setLoginBusy(true);
    try {
      const { data, error } = await supabaseClient.auth.signInWithIdToken({
        provider: 'google',
        token: res.credential,
      });
      if (error) throw error;
      await this._adoptSession(data.session);
    } catch (e) {
      console.error('signInWithIdToken:', e);
      this._showLoginError('Login gagal: ' + (e.message || e));
    } finally {
      this._setLoginBusy(false);
    }
  },

  // ---- localhost-only demo login (UI work without Google) ---------
  _appendDemoSwitch(container) {
    const div = document.createElement('div');
    div.className = 'login-demo-switch';
    div.innerHTML = `<button type="button" class="btn btn-secondary btn-sm" id="btn-switch-demo">Mode Demo (localhost)</button>`;
    container.parentElement.appendChild(div);
    div.querySelector('#btn-switch-demo').addEventListener('click', () => {
      div.remove();
      this._setupDemoLogin();
    });
  },

  _setupDemoLogin() {
    const container = document.getElementById('google-signin-btn');
    container.innerHTML = `
      <div class="demo-login">
        <p>Mode Demo — hanya untuk pengembangan lokal.</p>
        <input type="email" id="demo-email" class="input-field" placeholder="Email (harus ada di allowed_users)">
        <input type="text" id="demo-name" class="input-field" placeholder="Nama (opsional)">
        <button type="button" id="btn-demo-login" class="btn btn-primary">Masuk</button>
      </div>`;
    const go = async () => {
      const email = document.getElementById('demo-email').value.trim().toLowerCase();
      const name = document.getElementById('demo-name').value.trim() || email.split('@')[0];
      if (!email) return showToast('Masukkan email', 'error');
      const user = await DB.findUser(email);
      if (!user) return this._showLoginError('Email tidak ada di allowed_users.');
      this.currentUser = {
        email,
        name,
        picture: '',
        role: user.role,
        isSuperAdmin: user.isSuperAdmin || false,
      };
      await this.onLoginSuccess();
    };
    document.getElementById('btn-demo-login').addEventListener('click', go);
    ['demo-email', 'demo-name'].forEach((id) =>
      document.getElementById(id).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') go();
      })
    );
  },

  // ---- post-login UI wiring (ported from the old onLoginSuccess) ---
  async onLoginSuccess() {
    document.getElementById('login-page').hidden = true;
    document.getElementById('app-shell').hidden = false;

    const u = this.currentUser;
    document.getElementById('user-name').textContent = u.name || u.email;

    const avatar = document.getElementById('user-avatar');
    if (u.picture) {
      avatar.src = u.picture;
      avatar.hidden = false;
    } else {
      avatar.hidden = true;
    }

    const badge = document.getElementById('user-role-badge');
    badge.textContent = u.role.toUpperCase();
    badge.className = 'user-role-badge badge-' + u.role;

    document.body.classList.toggle('role-admin', this.isAdmin());
    document.body.classList.toggle('role-sales', this.isSales());
    document.body.classList.toggle('role-kurir', this.isKurir());
    document.body.classList.toggle('role-sales-kurir', u.role === 'sales_kurir');

    document
      .querySelectorAll('.courier-only')
      .forEach((el) => (el.hidden = !this.isKurir()));
    document
      .querySelectorAll('.kurir-form-only')
      .forEach((el) => (el.hidden = u.role !== 'sales_kurir'));

    const reportsMenu = document.querySelector('.nav-item[data-page="reports"]');
    if (reportsMenu) reportsMenu.hidden = u.role === 'sales_kurir';

    if (this.isAdmin()) {
      const fw = document.getElementById('admin-courier-filter-wrapper');
      const ca = document.getElementById('admin-courier-actions');
      if (fw) fw.hidden = false;
      if (ca) ca.hidden = false;
    }

    // Sales-role gets the cost-column toggle button; PriceList owns its state.
    const toggle = document.getElementById('btn-toggle-distribusi');
    if (toggle) toggle.hidden = !this.isSales();

    await PriceCalc.loadFormulas();
    Router.init();
  },

  async logout() {
    try {
      await supabaseClient.auth.signOut();
    } catch {}
    this._resetToLogin();
  },

  _resetToLogin() {
    this.currentUser = null;
    try {
      localStorage.removeItem(SESSION_HINT_KEY);
    } catch {}
    document.body.classList.remove('role-admin', 'role-sales', 'role-kurir', 'role-sales-kurir');
    document.getElementById('app-shell').hidden = true;
    document.getElementById('login-page').hidden = false;
    this._showLoginError('');
    window.location.hash = '';
    this._waitForGoogle();
  },

  showLoginPage() {
    document.getElementById('login-page').hidden = false;
    document.getElementById('app-shell').hidden = true;
  },

  _showLoginError(msg) {
    const el = document.getElementById('login-error');
    if (el) el.textContent = msg;
  },

  _setLoginBusy(busy) {
    const card = document.querySelector('.login-card');
    if (card) card.classList.toggle('is-busy', busy);
  },

  // ---- role helpers -----------------------------------------------
  isAdmin() {
    return this.currentUser?.role === 'admin';
  },
  isSales() {
    return ['sales', 'sales_kurir'].includes(this.currentUser?.role);
  },
  isKurir() {
    return ['sales_kurir', 'admin'].includes(this.currentUser?.role);
  },
};
