// ============================================================================
// pages/users.js — the whitelist: add / edit / remove allowed Google accounts.
// ============================================================================

import { DB } from '../db.js';
import { Auth } from '../auth.js';
import { formatDate, escapeHtml } from '../utils.js';
import { showToast, confirmModal, showLoading } from '../ui.js';

const ROLES = [
  ['sales', 'Sales'],
  ['sales_kurir', 'Sales + Kurir'],
  ['admin', 'Admin'],
];

export const UserManagement = {
  _wired: false,

  async render() {
    if (!this._wired) {
      this._wired = true;
      document.getElementById('add-user-form').addEventListener('submit', (e) => this.onAdd(e));
    }
    await this.renderTable();
  },

  async onAdd(e) {
    e.preventDefault();
    const emailInput = document.getElementById('input-user-email');
    const email = emailInput.value.trim().toLowerCase();
    const role = document.getElementById('select-user-role').value;
    if (!email) return;

    if (await DB.findUser(email)) return showToast('Email sudah terdaftar', 'error');

    const res = await DB.addUser(email, role, Auth.currentUser.email);
    if (res.ok) {
      showToast('User ditambahkan', 'success');
      emailInput.value = '';
      await this.renderTable();
    } else if (res.code === '23505') {
      showToast('Email sudah terdaftar', 'warning');
    } else {
      showToast('Gagal menambahkan user (cek policy RLS / koneksi)', 'error');
    }
  },

  async renderTable() {
    const tbody = document.getElementById('users-table-body');
    showLoading(tbody, 'Memuat user…');
    const users = await DB.getUsers();

    tbody.innerHTML = users
      .map(
        (u) => `
      <tr data-email="${escapeHtml(u.email)}" data-role="${escapeHtml(u.role)}">
        <td>${escapeHtml(u.email)} ${u.isSuperAdmin ? '<span class="tag tag-admin">SUPER ADMIN</span>' : ''}</td>
        <td><span class="user-role-badge badge-${escapeHtml(u.role)}">${escapeHtml(u.role.toUpperCase())}</span></td>
        <td>${escapeHtml(u.addedBy || '-')}</td>
        <td>${formatDate(u.addedAt)}</td>
        <td class="table-actions">
          ${
            u.isSuperAdmin
              ? ''
              : `<button class="btn btn-sm btn-secondary" data-action="edit">Edit</button>
                 <button class="btn btn-sm btn-danger" data-action="delete">Hapus</button>`
          }
        </td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('button[data-action]').forEach((btn) => {
      const tr = btn.closest('tr');
      const email = tr.dataset.email;
      if (btn.dataset.action === 'delete') {
        btn.addEventListener('click', async () => {
          const ok = await confirmModal({
            title: 'Hapus akses user?',
            message: `Akses untuk <strong>${escapeHtml(email)}</strong> akan dicabut.`,
            confirmText: 'Hapus',
            danger: true,
          });
          if (!ok) return;
          try {
            await DB.removeUser(email);
            showToast('User dihapus', 'success');
            await this.renderTable();
          } catch (err) {
            showToast('Gagal menghapus: ' + err.message, 'error');
          }
        });
      } else {
        btn.addEventListener('click', () => this.startEdit(tr, email, tr.dataset.role));
      }
    });
  },

  startEdit(tr, email, role) {
    tr.innerHTML = `
      <td><input type="email" class="input-field" data-edit="email" value="${escapeHtml(email)}"></td>
      <td>
        <select class="input-field" data-edit="role">
          ${ROLES.map(([v, l]) => `<option value="${v}" ${v === role ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </td>
      <td>—</td><td>—</td>
      <td class="table-actions">
        <button class="btn btn-sm btn-primary" data-action="save">Simpan</button>
        <button class="btn btn-sm btn-secondary" data-action="cancel">Batal</button>
      </td>`;

    tr.querySelector('[data-action="cancel"]').addEventListener('click', () => this.renderTable());
    tr.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const newEmail = tr.querySelector('[data-edit="email"]').value.trim().toLowerCase();
      const newRole = tr.querySelector('[data-edit="role"]').value;
      if (!newEmail) return;
      const res = await DB.updateUser(email, newEmail, newRole);
      if (res.ok) {
        showToast('User diperbarui', 'success');
        await this.renderTable();
      } else if (res.code === '23505') {
        showToast('Email sudah terdaftar', 'warning');
      } else {
        showToast('Gagal memperbarui user', 'error');
      }
    });
  },
};
