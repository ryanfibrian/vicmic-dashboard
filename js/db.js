// ============================================================================
// db.js — every Supabase read/write the app makes.
// ============================================================================

import { supabaseClient } from './config.js';

export const DB = {
  // ---- SETTINGS -----------------------------------------------------------
  async getSettings() {
    const { data, error } = await supabaseClient.from('app_settings').select('*');
    if (error) {
      console.error('getSettings:', error);
      return [];
    }
    return data;
  },

  async getSetting(key, fallback = null) {
    const { data, error } = await supabaseClient
      .from('app_settings')
      .select('setting_value')
      .eq('setting_key', key)
      .maybeSingle();
    if (error || !data) return fallback;
    return data.setting_value;
  },

  async saveSetting(key, value) {
    const { error } = await supabaseClient
      .from('app_settings')
      .upsert({ setting_key: key, setting_value: value }, { onConflict: 'setting_key' });
    if (error) throw error;
  },

  // ---- USER MANAGEMENT --------------------------------------------------
  async getUsers() {
    const { data, error } = await supabaseClient
      .from('allowed_users')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) {
      console.error('getUsers:', error);
      return [];
    }
    return data.map(mapUser);
  },

  async findUser(email) {
    const { data, error } = await supabaseClient
      .from('allowed_users')
      .select('*')
      .eq('email', email.toLowerCase())
      .maybeSingle();
    if (error || !data) return null;
    return mapUser(data);
  },

  async addUser(email, role, addedBy) {
    const { error } = await supabaseClient
      .from('allowed_users')
      .insert({ email: email.toLowerCase(), role, added_by: addedBy });
    if (error) {
      console.error('addUser:', error);
      return { ok: false, code: error.code };
    }
    return { ok: true };
  },

  async removeUser(email) {
    const { error } = await supabaseClient
      .from('allowed_users')
      .delete()
      .eq('email', email.toLowerCase());
    if (error) throw error;
  },

  async updateUser(oldEmail, newEmail, newRole) {
    const { error } = await supabaseClient
      .from('allowed_users')
      .update({ email: newEmail.toLowerCase(), role: newRole })
      .eq('email', oldEmail.toLowerCase());
    if (error) {
      console.error('updateUser:', error);
      return { ok: false, code: error.code };
    }
    return { ok: true };
  },

  async setAsSuperAdmin(email) {
    await supabaseClient
      .from('allowed_users')
      .update({ is_super_admin: true })
      .eq('email', email.toLowerCase());
  },

  // ---- PRICE DATA -----------------------------------------------------
  async saveData(dateStr, products, meta = {}) {
    await supabaseClient.from('price_data').delete().eq('date', dateStr);

    for (let i = 0; i < products.length; i += 500) {
      const rows = products.slice(i, i + 500).map((p) => ({
        date: dateStr,
        sku: p.sku,
        pn: p.pn,
        type: p.type,
        deskripsi: p.deskripsi,
        distribusi: p.distribusi,
        serpong: p.serpong,
        harco: p.harco,
        total: p.total,
        srp: p.srp,
        promo_sellout: p.promo_sellout,
      }));
      const { error } = await supabaseClient.from('price_data').insert(rows);
      if (error) {
        console.error('saveData:', error);
        throw new Error(
          `Database error: ${error.message}. Pastikan kolom sku, pn, type, srp, promo_sellout ada di tabel price_data.`
        );
      }
    }

    await this.saveUpload(dateStr, {
      filename: meta.filename || null,
      uploaded_by: meta.uploadedBy || null,
      row_count: products.length,
    });
  },

  async deleteData(dateStr) {
    const { error } = await supabaseClient.from('price_data').delete().eq('date', dateStr);
    if (error) throw error;
    // data_uploads row is pruned by a DB trigger (migration 003); best-effort here too.
    await supabaseClient.from('data_uploads').delete().eq('date', dateStr);
  },

  async getData(dateStr) {
    const { data, error } = await supabaseClient
      .from('price_data')
      .select('sku, pn, type, deskripsi, distribusi, serpong, harco, total, srp, promo_sellout')
      .eq('date', dateStr)
      .order('id', { ascending: true });
    if (error || !data || data.length === 0) return null;
    return data.map((p, i) => ({ no: i + 1, ...p }));
  },

  async getAllDates() {
    const { data, error } = await supabaseClient.rpc('get_distinct_dates');
    if (!error && data) return data.map((r) => r.date);

    const { data: fallback } = await supabaseClient
      .from('price_data')
      .select('date')
      .order('date', { ascending: false });
    if (!fallback) return [];
    return [...new Set(fallback.map((r) => r.date))];
  },

  // Kept for callers that used the old name.
  getAvailableDates() {
    return this.getAllDates();
  },

  async getLatestData() {
    const dates = await this.getAllDates();
    if (!dates.length) return null;
    const data = await this.getData(dates[0]);
    return data ? { date: dates[0], data } : null;
  },

  async getPreviousData(currentDateStr) {
    const dates = await this.getAllDates();
    const prev = dates.filter((d) => d < currentDateStr);
    if (!prev.length) return null;
    const data = await this.getData(prev[0]);
    return data ? { date: prev[0], data } : null;
  },

  // ---- UPLOAD HISTORY (data_uploads) -------------------------------
  async getUploads() {
    const { data, error } = await supabaseClient
      .from('data_uploads')
      .select('*')
      .order('date', { ascending: false });
    if (error) {
      console.warn('getUploads (table may not exist yet):', error.message);
      return [];
    }
    return data;
  },

  async saveUpload(dateStr, fields) {
    const { error } = await supabaseClient
      .from('data_uploads')
      .upsert({ date: dateStr, ...fields }, { onConflict: 'date' });
    if (error) console.warn('saveUpload:', error.message);
  },

  // ---- MANUAL RETENTION (admin button only; routine cleanup is pg_cron) ---
  async cleanupOldData(daysLimit) {
    const dates = await this.getAllDates();
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - daysLimit);
    const cutoffKey = cutoff.toISOString().split('T')[0];

    const toDelete = dates.filter((d) => d < cutoffKey);
    for (const d of toDelete) await this.deleteData(d);
    return toDelete.length;
  },
};

function mapUser(u) {
  return {
    email: u.email,
    role: u.role,
    isSuperAdmin: u.is_super_admin,
    addedBy: u.added_by,
    addedAt: u.created_at?.split('T')[0] || '',
  };
}
