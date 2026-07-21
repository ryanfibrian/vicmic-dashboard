// ============================================
// SUPABASE INITIALIZATION
// ============================================
const SUPABASE_URL = 'https://dpnndfgeyuqblpbfzlii.supabase.co';     // ← GANTI!
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwbm5kZmdleXVxYmxwYmZ6bGlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0MzMwNzQsImV4cCI6MjEwMDAwOTA3NH0.2qCER7lIRBsz3_JMVhKK4L9HQe4R_NVjsiwGo4uwOXY'; // ← GANTI!
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 1. CONFIG & CONSTANTS
const CONFIG = {
    GOOGLE_CLIENT_ID: '330235446046-t1omv0pvrkusl8k5dqnd37jhu1h62j2s.apps.googleusercontent.com',
    STORAGE_KEYS: {
        USERS: 'vicmic_users',
        DATA_PREFIX: 'vicmic_data_'
    },
    COLUMN_ALIASES: {
        distribusi: ['distribusi', 'harga dist', 'harga modal'],
        serpong: ['serpong', 'stok serpong', 'cabang serpong'],
        harco: ['harco', 'stok harco', 'cabang harco'],
        total: ['total', 'total stok', 'stok global'],
        deskripsi: ['new deskripsi', 'deskripsi', 'nama barang', 'item'],
        sku: ['sku', 'stock keeping unit', 'item code'],
        pn: ['pn', 'part number', 'part no'],
        type: ['new type', 'type', 'tipe', 'category'],
        srp: ['srp', 'suggested retail price', 'harga srp', 'harga ritel'],
        promo_sellout: ['promo sellout', 'promo', 'sellout', 'cashback']
    },
    REQUIRED_COLUMNS: ['distribusi', 'serpong', 'harco', 'total', 'deskripsi']
};

// 2. UTILITY FUNCTIONS
function formatNumber(num) {
    return Number(num).toLocaleString('id-ID');
}

function formatCurrency(num) {
    return 'Rp ' + formatNumber(num);
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function dateToKey(date) {
    return date.toISOString().split('T')[0];
}

function isSunday(dateStr) {
    const d = new Date(dateStr);
    return d.getDay() === 0;
}

function getEffectiveDate() {
    const today = new Date();
    if (today.getDay() === 0) {
        today.setDate(today.getDate() - 1);
    }
    return dateToKey(today);
}

async function getLatestDatabaseDate() {
    const dates = await DB.getAllDates();
    return dates.length > 0 ? dates[0] : getEffectiveDate();
}

function decodeJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return {};
    }
}

// 3. TOAST & MODAL (UI Helpers)
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function showModal(title, bodyHtml, buttons = []) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    const footer = document.getElementById('modal-footer');
    footer.innerHTML = '';
    buttons.forEach(btn => {
        const el = document.createElement('button');
        el.className = `btn ${btn.class || 'btn-secondary'}`;
        el.textContent = btn.text;
        el.addEventListener('click', btn.onClick);
        footer.appendChild(el);
    });
    document.getElementById('modal-overlay').classList.add('show');
}

function hideModal() {
    document.getElementById('modal-overlay').classList.remove('show');
}

// 4. DATABASE MODULE (Supabase Version)
const DB = {
    // ---- SETTINGS ----
    async getSettings() {
        const { data, error } = await supabaseClient
            .from('app_settings')
            .select('*');
        if (error) {
            console.error('Failed to get settings:', error);
            return [];
        }
        return data;
    },

    async cleanupOldData(daysLimit = 60) {
        try {
            const dates = await this.getAvailableDates();
            const today = new Date();
            today.setHours(0,0,0,0);
            
            const toDelete = dates.filter(d => {
                const diffTime = today - new Date(d); // only old dates
                return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) > daysLimit;
            });
            
            for (const d of toDelete) {
                await this.deleteData(d);
                // Also clean up metadata
                const meta = JSON.parse(localStorage.getItem('upload_metadata') || '{}');
                if (meta[d]) {
                    delete meta[d];
                    localStorage.setItem('upload_metadata', JSON.stringify(meta));
                }
            }
            if (toDelete.length > 0) {
                console.log(`Auto-cleaned ${toDelete.length} old history records.`);
            }
        } catch(err) {
            console.error('Failed to cleanup old data', err);
        }
    },

    async saveSetting(key, value) {
        const { data, error } = await supabaseClient
            .from('app_settings')
            .upsert({ setting_key: key, setting_value: value }, { onConflict: 'setting_key' });
        if (error) {
            throw error;
        }
        return data;
    },

    // ---- USER MANAGEMENT ----
    async getUsers() {
        const { data, error } = await supabaseClient
            .from('allowed_users')
            .select('*')
            .order('created_at', { ascending: true });
        if (error) { console.error('getUsers error:', error); return []; }
        return data.map(u => ({
            email: u.email,
            role: u.role,
            isSuperAdmin: u.is_super_admin,
            addedBy: u.added_by,
            addedAt: u.created_at?.split('T')[0] || ''
        }));
    },

    async addUser(email, role, addedBy) {
        const { error } = await window.supabaseClient
            .from('allowed_users')
            .insert({ email: email.toLowerCase(), role, added_by: addedBy });
        if (error) {
            console.error('addUser error:', error);
            if (error.code === '23505') showToast('Email sudah terdaftar', 'warning');
            else showToast('Gagal menambahkan user (cek database)', 'error');
            return false;
        }
        return true;
    },

    async removeUser(email) {
        const { error } = await supabaseClient
            .from('allowed_users')
            .delete()
            .eq('email', email.toLowerCase());
        if (error) console.error('removeUser error:', error);
    },

    async updateUser(oldEmail, newEmail, newRole) {
        const { error } = await supabaseClient
            .from('allowed_users')
            .update({ email: newEmail.toLowerCase(), role: newRole })
            .eq('email', oldEmail.toLowerCase());
        if (error) {
            console.error('updateUser error:', error);
            if (error.code === '23505') showToast('Email sudah terdaftar', 'warning');
            return false;
        }
        return true;
    },

    async findUser(email) {
        const { data, error } = await supabaseClient
            .from('allowed_users')
            .select('*')
            .eq('email', email.toLowerCase())
            .maybeSingle();
        if (error || !data) return null;
        return {
            email: data.email,
            role: data.role,
            isSuperAdmin: data.is_super_admin,
            addedBy: data.added_by,
            addedAt: data.created_at?.split('T')[0] || ''
        };
    },

    async setAsSuperAdmin(email) {
        await supabaseClient
            .from('allowed_users')
            .update({ is_super_admin: true })
            .eq('email', email.toLowerCase());
    },

    // ---- PRICE DATA ----
    async saveData(dateStr, products) {
        // Hapus data lama untuk tanggal ini (re-upload)
        await supabaseClient
            .from('price_data')
            .delete()
            .eq('date', dateStr);

        // Insert batch (chunk per 500 rows untuk menghindari limit)
        const chunks = [];
        for (let i = 0; i < products.length; i += 500) {
            chunks.push(products.slice(i, i + 500));
        }

        for (const chunk of chunks) {
            const rows = chunk.map(p => ({
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
                promo_sellout: p.promo_sellout
            }));
            const { error } = await supabaseClient.from('price_data').insert(rows);
            if (error) { 
                console.error('saveData error:', error);
                throw new Error(`Database error: ${error.message}. Pastikan Anda sudah menambahkan kolom sku, pn, type, srp, dan promo_sellout di Supabase!`);
            }
        }
    },

    async getAvailableDates() {
        const { data, error } = await supabaseClient
            .rpc('get_distinct_dates');
            
        if (error || !data) {
            // Fallback if RPC fails
            const { data: fallback } = await supabaseClient
                .from('price_data')
                .select('date')
                .order('date', { ascending: false });
            if (fallback) {
                const uniqueDates = [...new Set(fallback.map(d => d.date))];
                return uniqueDates;
            }
            return [];
        }
        return data.map(d => d.date);
    },

    async deleteData(dateStr) {
        const { error } = await supabaseClient
            .from('price_data')
            .delete()
            .eq('date', dateStr);
        if (error) throw error;
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
        // Query distinct dates, sorted newest first
        const { data, error } = await supabaseClient
            .rpc('get_distinct_dates');

        if (error) {
            // Fallback: query directly (kurang efisien tapi tetap jalan)
            const { data: fallback } = await supabaseClient
                .from('price_data')
                .select('date')
                .order('date', { ascending: false });
            if (!fallback) return [];
            return [...new Set(fallback.map(r => r.date))];
        }
        return data.map(r => r.date);
    },

    async getLatestData() {
        const dates = await this.getAllDates();
        if (dates.length === 0) return null;
        const data = await this.getData(dates[0]);
        return data ? { date: dates[0], data } : null;
    },

    async getPreviousData(currentDateStr) {
        const dates = await this.getAllDates();
        const prev = dates.filter(d => d < currentDateStr);
        if (prev.length === 0) return null;
        const data = await this.getData(prev[0]);
        return data ? { date: prev[0], data } : null;
    }
};

// 5. AUTH MODULE (Auth object)
const Auth = {
    currentUser: null,

    async init() {
        // Check existing session in localStorage
        const saved = localStorage.getItem('vicmic_session');
        if (saved) {
            this.currentUser = JSON.parse(saved);
            if (await this.verifyUser(this.currentUser.email)) {
                await this.onLoginSuccess();
                return;
            }
        }
        this.showLoginPage();
        // Wait for Google script to load, then init, with fallback to demo login
        this.waitForGoogle();
    },

    waitForGoogle() {
        // Try to init Google Sign-In, retry up to 3 seconds, then fallback to demo
        let attempts = 0;
        const tryInit = () => {
            if (typeof google !== 'undefined' && google.accounts) {
                this.initGoogleSignIn();
            } else if (attempts < 30) {
                attempts++;
                setTimeout(tryInit, 100);
            } else {
                this.setupDemoLogin();
            }
        };
        tryInit();
    },

    initGoogleSignIn() {
        try {
            // Cek apakah Client ID masih placeholder
            if (!CONFIG.GOOGLE_CLIENT_ID || CONFIG.GOOGLE_CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID') {
                console.warn('Google Client ID belum dikonfigurasi');
                this.setupDemoLogin();
                return;
            }

            google.accounts.id.initialize({
                client_id: CONFIG.GOOGLE_CLIENT_ID,
                callback: (response) => this.handleCredentialResponse(response),
                auto_select: false
            });
            google.accounts.id.renderButton(
                document.getElementById('google-signin-btn'),
                { theme: 'filled_blue', size: 'large', width: 300, text: 'signin_with', shape: 'rectangular' }
            );

            // Tambahkan tombol Demo Mode di bawah Google button
            const fallbackDiv = document.createElement('div');
            fallbackDiv.style.cssText = 'margin-top: 1.5rem; text-align: center;';
            fallbackDiv.innerHTML = `
                <p style="color: var(--text-muted); font-size: 0.78rem; margin-bottom: 0.5rem;">
                    Google Sign-In bermasalah?
                </p>
                <button id="btn-switch-demo" class="btn btn-secondary btn-sm"
                    style="font-size: 0.8rem;">
                    Gunakan Mode Demo
                </button>
            `;
            document.getElementById('google-signin-btn').parentElement.appendChild(fallbackDiv);
            document.getElementById('btn-switch-demo').addEventListener('click', () => {
                fallbackDiv.remove();
                this.setupDemoLogin();
            });
        } catch (e) {
            console.warn('Google Sign-In init failed:', e);
            this.setupDemoLogin();
        }
    },

    setupDemoLogin() {
        // Demo login for development/testing without valid Google Client ID
        const container = document.getElementById('google-signin-btn');
        container.innerHTML = `
            <div class="demo-login">
                <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 0.75rem;">
                    Mode Demo — Masukkan email untuk login
                </p>
                <input type="email" id="demo-email" class="input-field" placeholder="Email Google Anda" style="margin-bottom: 0.5rem;">
                <input type="text" id="demo-name" class="input-field" placeholder="Nama Lengkap" style="margin-bottom: 0.75rem;">
                <button id="btn-demo-login" class="btn btn-primary" style="width: 100%;">Login</button>
            </div>
        `;
        document.getElementById('btn-demo-login').addEventListener('click', async () => {
            const email = document.getElementById('demo-email').value.trim();
            const name = document.getElementById('demo-name').value.trim() || email.split('@')[0];
            if (!email) { showToast('Masukkan email!', 'error'); return; }
            await this.processLogin(email, name, '');
        });
        // Also support Enter key
        ['demo-email', 'demo-name'].forEach(id => {
            document.getElementById(id)?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') document.getElementById('btn-demo-login').click();
            });
        });
    },

    async handleCredentialResponse(response) {
        const payload = decodeJwt(response.credential);
        await this.processLogin(payload.email, payload.name, payload.picture);
    },

    async processLogin(email, name, picture) {
        email = email.toLowerCase();
        const users = await DB.getUsers();

        // First user EVER = Super Admin
        if (users.length === 0) {
            await DB.addUser(email, 'admin', 'system');
            await DB.setAsSuperAdmin(email);
            showToast(`${name}, Anda terdaftar sebagai Super Admin!`, 'success');
        }

        const user = await DB.findUser(email);
        if (!user) {
            document.getElementById('login-error').textContent = 'Email Anda belum terdaftar. Hubungi Admin.';
            showToast('Akses ditolak: Email belum di-whitelist', 'error');
            return;
        }

        this.currentUser = { email, name, picture, role: user.role, isSuperAdmin: user.isSuperAdmin || false };
        localStorage.setItem('vicmic_session', JSON.stringify(this.currentUser));
        await this.onLoginSuccess();
    },

    async onLoginSuccess() {
        document.getElementById('login-page').style.display = 'none';
        document.getElementById('app-shell').style.display = '';

        // Set user info in sidebar
        document.getElementById('user-name').textContent = this.currentUser.name || this.currentUser.email;
        const avatar = document.getElementById('user-avatar');
        if (this.currentUser.picture) {
            avatar.src = this.currentUser.picture;
            avatar.style.display = '';
        } else {
            avatar.style.display = 'none';
        }
        const badge = document.getElementById('user-role-badge');
        badge.textContent = this.currentUser.role.toUpperCase();
        badge.className = 'user-role-badge badge-' + this.currentUser.role;

        if (this.isKurir()) {
            document.querySelectorAll('.courier-only').forEach(el => el.style.display = '');
        } else {
            document.querySelectorAll('.courier-only').forEach(el => el.style.display = 'none');
        }

        if (this.isSales()) {
            document.body.classList.add('role-sales');
            document.getElementById('btn-toggle-distribusi').style.display = 'inline-block';
            PriceList.distribusiVisible = false;
            document.getElementById('btn-toggle-distribusi').innerHTML = '👁️ Show Distribusi';
        } else {
            document.body.classList.remove('role-sales');
            document.getElementById('btn-toggle-distribusi').style.display = 'none';
            PriceList.distribusiVisible = true;
        }

        await PriceCalc.loadFormulas();
        Router.init();
    },

    async verifyUser(email) { return !!(await DB.findUser(email.toLowerCase())); },
    isAdmin() { return this.currentUser && this.currentUser.role === 'admin'; },
    isSales() { return this.currentUser && (this.currentUser.role === 'sales' || this.currentUser.role === 'sales_kurir'); },
    isKurir() { return this.currentUser && (this.currentUser.role === 'sales_kurir' || this.currentUser.role === 'admin'); },

    logout() {
        this.currentUser = null;
        localStorage.removeItem('vicmic_session');
        document.body.classList.remove('role-sales');
        document.getElementById('app-shell').style.display = 'none';
        document.getElementById('login-page').style.display = '';
        document.getElementById('login-error').textContent = '';
        window.location.hash = '';
        this.waitForGoogle();
    },

    showLoginPage() {
        document.getElementById('login-page').style.display = '';
        document.getElementById('app-shell').style.display = 'none';
    }
};

// 6. ROUTER MODULE
const Router = {
    currentPage: null,
    initialized: false,

    init() {
        if (!this.initialized) {
            window.addEventListener('hashchange', () => this.handleRoute());

            document.querySelectorAll('.nav-item').forEach(item => {
                item.addEventListener('click', () => {
                    window.location.hash = item.dataset.page;
                    document.getElementById('sidebar').classList.remove('open');
                    document.getElementById('sidebar-overlay').classList.remove('show');
                });
            });
            this.initialized = true;
        }

        const defaultPage = Auth.isAdmin() ? 'dashboard' : 'pricelist';
        if (window.location.hash && window.location.hash !== '#') {
            this.handleRoute();
        } else {
            window.location.hash = defaultPage;
        }
    },

    handleRoute() {
        let page = window.location.hash.replace('#', '') || (Auth.isAdmin() ? 'dashboard' : 'pricelist');

        // Guard: Sales can only see pricelist and reports (and courier if kurir)
        if (Auth.isSales() && page !== 'pricelist' && page !== 'reports' && !(Auth.isKurir() && page === 'courier')) {
            window.location.hash = 'pricelist';
            return;
        }

        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const target = document.getElementById('page-' + page);
        if (target) {
            target.classList.add('active');
            this.currentPage = page;
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.toggle('active', item.dataset.page === page);
            });
            this.renderPage(page);
        }
    },

    async renderPage(page) {
        switch (page) {
            case 'dashboard': await Dashboard.render(); break;
            case 'pricelist': await PriceList.render(); break;
            case 'reports': await Reports.render(); break;
            case 'users': await UserManagement.render(); break;
            case 'upload': await Upload.render(); break;
            case 'settings': await Settings.render(); break;
            case 'courier': if (Auth.isKurir()) await Courier.loadLogs(); break;
        }
    }
};

// 7. EXCEL PARSER MODULE
const ExcelParser = {
    parse(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: '' });

                    if (jsonData.length === 0) { reject('File Excel kosong'); return; }

                    const headers = Object.keys(jsonData[0]);
                    const mapping = this.autoMapColumns(headers);

                    if (mapping.unmapped.length > 0) {
                        this.showMappingModal(headers, mapping, (finalMapping) => {
                            const products = this.extractProducts(jsonData, finalMapping.mapped);
                            resolve(products);
                        }, reject);
                    } else {
                        const products = this.extractProducts(jsonData, mapping.mapped);
                        resolve(products);
                    }
                } catch (err) {
                    reject('Error parsing Excel: ' + err.message);
                }
            };
            reader.onerror = () => reject('Error membaca file');
            reader.readAsArrayBuffer(file);
        });
    },

    autoMapColumns(headers) {
        const mapped = {};
        const unmapped = [];
        for (const [field, aliases] of Object.entries(CONFIG.COLUMN_ALIASES)) {
            const match = headers.find(h =>
                aliases.some(a => h.toLowerCase().trim().includes(a.toLowerCase()))
            );
            if (match) { mapped[field] = match; }
            else { unmapped.push(field); }
        }
        return { mapped, unmapped };
    },

    showMappingModal(headers, partialMapping, onSuccess, onReject) {
        const mapped = { ...partialMapping.mapped };
        const unmapped = partialMapping.unmapped;
        const fieldLabels = {
            distribusi: 'Harga Distribusi',
            serpong: 'Stok Serpong',
            harco: 'Stok Harco',
            total: 'Total Stok',
            deskripsi: 'Deskripsi / Nama Barang'
        };

        let html = '<p style="margin-bottom:1rem;color:var(--text-secondary)">Beberapa kolom tidak dapat dideteksi otomatis. Pilih kolom yang sesuai:</p>';
        unmapped.forEach(field => {
            html += `<div style="margin-bottom:1rem;">
                <label style="display:block;margin-bottom:0.25rem;font-weight:500;">${fieldLabels[field]}:</label>
                <select class="input-field mapping-select" data-field="${field}" style="width:100%">
                    <option value="">-- Pilih Kolom --</option>
                    ${headers.map(h => `<option value="${h}">${h}</option>`).join('')}
                </select>
            </div>`;
        });

        showModal('🔗 Smart Column Mapping', html, [
            {
                text: 'Konfirmasi Mapping',
                class: 'btn-primary',
                onClick: () => {
                    document.querySelectorAll('.mapping-select').forEach(sel => {
                        if (sel.value) mapped[sel.dataset.field] = sel.value;
                    });
                    const stillUnmapped = CONFIG.REQUIRED_COLUMNS.filter(c => !mapped[c]);
                    if (stillUnmapped.length > 0) {
                        showToast('Semua kolom wajib harus dipetakan!', 'error');
                        return;
                    }
                    hideModal();
                    onSuccess({ mapped });
                }
            },
            {
                text: 'Batal',
                class: 'btn-secondary',
                onClick: () => { hideModal(); onReject('Upload dibatalkan'); }
            }
        ]);
    },

    extractProducts(jsonData, mapping) {
        return jsonData.map((row, i) => ({
            no: i + 1,
            sku: String(row[mapping.sku] || '').trim(),
            pn: String(row[mapping.pn] || '').trim(),
            type: String(row[mapping.type] || '').trim(),
            deskripsi: String(row[mapping.deskripsi] || '').trim(),
            distribusi: parseFloat(String(row[mapping.distribusi]).replace(/[^0-9.-]/g, '')) || 0,
            serpong: parseInt(String(row[mapping.serpong]).replace(/[^0-9-]/g, '')) || 0,
            harco: parseInt(String(row[mapping.harco]).replace(/[^0-9-]/g, '')) || 0,
            total: parseInt(String(row[mapping.total]).replace(/[^0-9-]/g, '')) || 0,
            srp: parseFloat(String(row[mapping.srp]).replace(/[^0-9.-]/g, '')) || 0,
            promo_sellout: String(row[mapping.promo_sellout] || '').trim()
        })).filter(p => p.deskripsi !== '');
    }
};

// 8. PRICE CALCULATOR & SETTINGS MODULE
const PriceCalc = {
    _onlineFormula: null,
    _offlineFormula: null,

    async loadFormulas() {
        const settings = await DB.getSettings();
        if (settings && settings.length > 0) {
            settings.forEach(s => {
                if (s.setting_key === 'formula_online') {
                    this._onlineFormula = s.setting_value;
                } else if (s.setting_key === 'formula_offline') {
                    this._offlineFormula = s.setting_value;
                }
            });
        }
    },

    hargaOnline(h) {
        if (!h || h <= 0) return 0;
        if (this._onlineFormula) {
            try {
                const func = new Function('h', this._onlineFormula);
                return func(h);
            } catch (e) {
                console.error("Error executing Online Formula:", e);
                return 0;
            }
        }
        // Fallback
        return 0;
    },
    hargaOffline(h) {
        if (!h || h <= 0) return 0;
        if (this._offlineFormula) {
            try {
                const func = new Function('h', this._offlineFormula);
                return func(h);
            } catch (e) {
                console.error("Error executing Offline Formula:", e);
                return 0;
            }
        }
        // Fallback
        return 0;
    }
};

const Settings = {
    async render() {
        // Fetch current formulas from DB (or use the one in PriceCalc)
        await PriceCalc.loadFormulas();
        
        const inputOnline = document.getElementById('input-formula-online');
        const inputOffline = document.getElementById('input-formula-offline');
        const btnSave = document.getElementById('btn-save-formulas');
        const btnCancel = document.getElementById('btn-cancel-formulas');
        
        inputOnline.value = PriceCalc._onlineFormula || '';
        inputOffline.value = PriceCalc._offlineFormula || '';
        
        // Remove previous listeners if any (clone node technique)
        const newBtn = btnSave.cloneNode(true);
        btnSave.parentNode.replaceChild(newBtn, btnSave);
        
        const newBtnCancel = btnCancel.cloneNode(true);
        btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
        
        let countdownInterval = null;
        let countdownValue = 5;
        let isConfirming = false;
        
        newBtn.addEventListener('click', async () => {
            if (!isConfirming) {
                // First click: start countdown
                isConfirming = true;
                countdownValue = 5;
                newBtn.textContent = `Ya, Simpan Perubahan (${countdownValue})`;
                newBtn.classList.remove('btn-primary');
                newBtn.style.backgroundColor = 'var(--danger)';
                newBtn.style.color = 'white';
                newBtn.style.border = 'none';
                newBtn.style.opacity = '0.7';
                newBtn.style.cursor = 'not-allowed';
                newBtnCancel.style.display = 'block';
                
                countdownInterval = setInterval(() => {
                    countdownValue--;
                    if (countdownValue > 0) {
                        newBtn.textContent = `Ya, Simpan Perubahan (${countdownValue})`;
                    } else {
                        clearInterval(countdownInterval);
                        newBtn.textContent = `Ya, Konfirmasi Simpan!`;
                        newBtn.style.opacity = '1';
                        newBtn.style.cursor = 'pointer';
                    }
                }, 1000);
            } else if (countdownValue <= 0) {
                // Second click (after countdown): perform save
                isConfirming = false;
                newBtn.textContent = 'Menyimpan...';
                newBtn.style.cursor = 'wait';
                newBtn.style.opacity = '0.7';
                
                try {
                    await DB.saveSetting('formula_online', inputOnline.value);
                    await DB.saveSetting('formula_offline', inputOffline.value);
                    await PriceCalc.loadFormulas(); // Reload into memory
                    showToast('Rumus berhasil diperbarui!', 'success');
                } catch (e) {
                    showToast('Gagal menyimpan rumus: ' + e.message, 'error');
                }
                
                // Reset button
                newBtn.textContent = '💾 Ubah Rumus';
                newBtn.style.backgroundColor = '';
                newBtn.style.color = '';
                newBtn.style.border = '';
                newBtn.classList.add('btn-primary');
                newBtn.style.cursor = 'pointer';
                newBtn.style.opacity = '1';
                newBtnCancel.style.display = 'none';
            }
        });
        
        newBtnCancel.addEventListener('click', () => {
            if (countdownInterval) clearInterval(countdownInterval);
            isConfirming = false;
            
            // Reset button
            newBtn.textContent = '💾 Ubah Rumus';
            newBtn.style.backgroundColor = '';
            newBtn.style.color = '';
            newBtn.style.border = '';
            newBtn.classList.add('btn-primary');
            newBtn.style.cursor = 'pointer';
            newBtn.style.opacity = '1';
            
            newBtnCancel.style.display = 'none';
        });
    }
};

// 9. DASHBOARD MODULE
const Dashboard = {
    async render() {
        // Let's use the latest database date for the dashboard
        const currentDateStr = await getLatestDatabaseDate();
        document.getElementById('dashboard-date-label').textContent = formatDate(currentDateStr);

        let dataObj = await DB.getData(currentDateStr);
        let prevDataObj = await DB.getPreviousData(currentDateStr);

        const data = dataObj || [];
        const prevData = prevDataObj ? prevDataObj.data : [];

        this.renderKPIs(data, prevData);
        this.renderPriceAlerts(data, prevData);
        this.renderStockAlerts(data, prevData);
        this.renderRecommendations(data);
        
        const tfSelect = document.getElementById('chart-timeframe');
        if (tfSelect) {
            const newTfSelect = tfSelect.cloneNode(true);
            tfSelect.parentNode.replaceChild(newTfSelect, tfSelect);
            
            newTfSelect.addEventListener('change', async (e) => {
                const limit = parseInt(e.target.value);
                await this.renderBrandChart(currentDateStr, limit);
            });
            
            await this.renderBrandChart(currentDateStr, parseInt(newTfSelect.value) || 7);
        } else {
            await this.renderBrandChart(currentDateStr, 7);
        }
    },

    renderKPIs(data, prevData) {
        const grid = document.getElementById('kpi-grid');
        let totalSerpong = 0;
        let totalHarco = 0;
        let totalGlobal = 0;

        const newProducts = [];
        const outOfStock = [];

        const prevMap = new Map();
        prevData.forEach(p => prevMap.set(p.deskripsi.toLowerCase(), p));

        const currentMap = new Map();
        data.forEach(p => {
            currentMap.set(p.deskripsi.toLowerCase(), p);
            totalSerpong += p.serpong;
            totalHarco += p.harco;
            totalGlobal += p.total;
            if (!prevMap.has(p.deskripsi.toLowerCase())) {
                newProducts.push(p);
            }
        });

        prevData.forEach(p => {
            if (!currentMap.has(p.deskripsi.toLowerCase())) {
                outOfStock.push(p);
            }
        });

        const kpis = [
            { label: 'Total Tipe Produk', value: data.length, icon: '📦', color: '#667eea' },
            { label: 'Total Stok Global', value: totalGlobal, icon: '🌍', color: '#764ba2' },
            { label: 'Stok Serpong', value: totalSerpong, icon: '🏬', color: '#00d4ff' },
            { label: 'Stok Harco', value: totalHarco, icon: '🏢', color: '#ff6b6b' },
            { label: 'Produk Baru', value: newProducts.length, icon: '✨', color: '#00e676' },
            { label: 'Produk Habis', value: outOfStock.length, icon: '🚫', color: '#ffab00' }
        ];

        grid.innerHTML = kpis.map(k =>
            `<div class="kpi-card glass-card" style="--card-accent: ${k.color}">
                <div class="kpi-icon">${k.icon}</div>
                <div class="kpi-value">${formatNumber(k.value)}</div>
                <div class="kpi-label">${k.label}</div>
            </div>`
        ).join('');
    },

    renderPriceAlerts(data, prevData) {
        const container = document.getElementById('price-alert-list');
        const prevMap = new Map();
        prevData.forEach(p => prevMap.set(p.deskripsi.toLowerCase(), p.distribusi));

        const alerts = [];
        data.forEach(p => {
            const lowerDesc = p.deskripsi.toLowerCase();
            if (prevMap.has(lowerDesc)) {
                const prevPrice = prevMap.get(lowerDesc);
                if (p.distribusi !== prevPrice) {
                    alerts.push({
                        deskripsi: p.deskripsi,
                        diff: p.distribusi - prevPrice,
                        old: prevPrice,
                        new: p.distribusi
                    });
                }
            }
        });

        alerts.sort((a, b) => {
            if (a.diff > 0 && b.diff < 0) return -1;
            if (a.diff < 0 && b.diff > 0) return 1;
            return Math.abs(b.diff) - Math.abs(a.diff);
        });
        const toShow = alerts.slice(0, 50);

        if (toShow.length === 0) {
            container.innerHTML = '<div class="empty-state">Belum ada data perbandingan</div>';
            return;
        }

        container.innerHTML = `<div class="alert-count">${alerts.length} produk berubah harga</div>` +
            toShow.map(a => {
                const isUp = a.diff > 0;
                return `<div class="price-alert-item">
                    <div class="alert-product">${a.deskripsi}</div>
                    <div class="alert-prices">
                        <span class="alert-old">${formatCurrency(a.old)}</span>
                        <span class="alert-arrow ${isUp ? 'price-up' : 'price-down'}">${isUp ? '▲' : '▼'}</span>
                        <span class="alert-new">${formatCurrency(a.new)}</span>
                    </div>
                    <div class="alert-diff ${isUp ? 'price-up' : 'price-down'}">
                        ${isUp ? '+' : '-'}${formatCurrency(Math.abs(a.diff))}
                    </div>
                </div>`;
            }).join('');
    },

    renderStockAlerts(data, prevData) {
        const container = document.getElementById('stock-alert-list');
        const prevMap = new Map();
        prevData.forEach(p => prevMap.set(p.deskripsi.toLowerCase(), p.total || 0));

        const alerts = [];
        const currentKeys = new Set();
        
        data.forEach(p => {
            const lowerDesc = p.deskripsi.toLowerCase();
            currentKeys.add(lowerDesc);
            const currentStock = p.total || 0;
            
            if (prevMap.has(lowerDesc)) {
                const prevStock = prevMap.get(lowerDesc);
                if (currentStock !== prevStock) {
                    alerts.push({
                        deskripsi: p.deskripsi,
                        diff: currentStock - prevStock,
                        old: prevStock,
                        new: currentStock,
                        type: 'change'
                    });
                }
            } else {
                alerts.push({
                    deskripsi: p.deskripsi,
                    diff: currentStock,
                    old: 0,
                    new: currentStock,
                    type: 'new'
                });
            }
        });

        prevData.forEach(p => {
            const lowerDesc = p.deskripsi.toLowerCase();
            if (!currentKeys.has(lowerDesc)) {
                const prevStock = p.total || 0;
                alerts.push({
                    deskripsi: p.deskripsi,
                    diff: -prevStock,
                    old: prevStock,
                    new: 0,
                    type: 'oos'
                });
            }
        });

        alerts.sort((a, b) => {
            if (a.diff > 0 && b.diff < 0) return -1;
            if (a.diff < 0 && b.diff > 0) return 1;
            return Math.abs(b.diff) - Math.abs(a.diff);
        });
        const toShow = alerts.slice(0, 50);

        if (toShow.length === 0) {
            container.innerHTML = '<div class="empty-state">Belum ada data perubahan stok</div>';
            return;
        }

        container.innerHTML = `<div class="alert-count">${alerts.length} produk berubah stok</div>` +
            toShow.map(a => {
                const isUp = a.diff > 0;
                let badge = '';
                if (a.type === 'new') badge = '<span class="badge-new-blink" style="font-size:0.6em; padding:2px 4px; margin-right:5px; vertical-align:middle;">BARU</span>';
                if (a.type === 'oos') badge = '<span style="color:var(--danger); font-size:0.6em; padding:2px 4px; border:1px solid var(--danger); border-radius:4px; margin-right:5px; vertical-align:middle;">HABIS</span>';
                
                return `<div class="price-alert-item">
                    <div class="alert-product">${badge}${a.deskripsi}</div>
                    <div class="alert-prices">
                        <span class="alert-old" style="text-decoration:none; opacity:0.6; font-weight:normal; font-size:0.85em;">${a.old}</span>
                        <span class="alert-arrow ${isUp ? 'stock-up' : 'stock-down'}">${isUp ? '▲' : '▼'}</span>
                        <span class="alert-new" style="font-weight:bold;">${a.new}</span>
                    </div>
                    <div class="alert-diff ${isUp ? 'stock-up' : 'stock-down'}">
                        ${isUp ? '+' : '-'}${Math.abs(a.diff)}
                    </div>
                </div>`;
            }).join('');
    },

    renderRecommendations(data) {
        const pullSerpong = [];
        const returnHarco = [];
        
        data.forEach(item => {
            const srp = parseFloat(item.serpong) || 0;
            const hrc = parseFloat(item.harco) || 0;
            
            // Rekomendasi Tarik ke Serpong: serpong <= 1 AND harco > 10
            if (srp <= 1 && hrc > 10) {
                pullSerpong.push(item);
            }
            
            // Rekomendasi Retur ke Harco: harco < 5 AND serpong > 0
            if (hrc < 5 && srp > 0) {
                returnHarco.push(item);
            }
        });
        
        // Urutkan berdasarkan stok harco terbanyak
        pullSerpong.sort((a, b) => (parseFloat(b.harco) || 0) - (parseFloat(a.harco) || 0));
        
        // Urutkan berdasarkan stok harco paling sedikit (ascending)
        returnHarco.sort((a, b) => (parseFloat(a.harco) || 0) - (parseFloat(b.harco) || 0));

        const renderRow = (item) => `
            <tr>
                <td style="text-align: left;" class="col-deskripsi">
                    ${item.deskripsi}
                    <button class="btn btn-sm btn-secondary btn-copy" data-text="${item.deskripsi.replace(/"/g, '&quot;')}" title="Copy Deskripsi" style="padding: 0 4px; margin-left: 5px; font-size: 0.8em; border: none; background: transparent;">📋</button>
                </td>
                <td style="text-align: right;">${item.serpong || 0}</td>
                <td style="text-align: right;">${item.harco || 0}</td>
            </tr>
        `;
        
        const tbodyPull = document.getElementById('pull-serpong-body');
        if (pullSerpong.length === 0) {
            tbodyPull.innerHTML = '<tr><td colspan="3" style="text-align:center">Tidak ada rekomendasi tarik ke serpong</td></tr>';
        } else {
            tbodyPull.innerHTML = pullSerpong.map((item) => renderRow(item)).join('');
        }
        
        const tbodyReturn = document.getElementById('return-harco-body');
        if (returnHarco.length === 0) {
            tbodyReturn.innerHTML = '<tr><td colspan="3" style="text-align:center">Tidak ada rekomendasi retur ke harco</td></tr>';
        } else {
            tbodyReturn.innerHTML = returnHarco.map((item) => renderRow(item)).join('');
        }
        
        // Setup copy buttons
        document.querySelectorAll('#page-dashboard .btn-copy').forEach(btn => {
            btn.onclick = async (e) => {
                const text = e.target.dataset.text;
                try {
                    await navigator.clipboard.writeText(text);
                    showToast('Tersalin: ' + text, 'success');
                } catch (err) {
                    showToast('Gagal menyalin', 'error');
                }
            };
        });
    },

    async renderBrandChart(currentDateStr, daysLimit = 7) {
        const allDates = await DB.getAllDates();
        // Fetch up to daysLimit, reverse so oldest is first
        const dates = allDates.filter(d => d <= currentDateStr).slice(0, daysLimit).reverse(); 
        
        if (dates.length === 0) return;

        const histories = [];
        for (const d of dates) {
            histories.push(await DB.getData(d));
        }

        // Aggregate by brand
        const brandsData = {};
        const regex = /(?:NOTEBOOK|PC)\s+([A-Za-z0-9]+)/i;

        histories.forEach((dayData, dayIndex) => {
            dayData.forEach(item => {
                const match = item.deskripsi.match(regex);
                if (match && match[1]) {
                    const brand = match[1].toUpperCase();
                    if (!brandsData[brand]) {
                        brandsData[brand] = new Array(dates.length).fill(0);
                    }
                    brandsData[brand][dayIndex] += (parseFloat(item.total) || 0);
                }
            });
        });

        const brandNames = Object.keys(brandsData);
        
        const brandColors = {
            'ACER': '#10B981',  // Hijau
            'ASUS': '#1E3A8A',  // Biru Tua
            'AXIOO': '#EAB308', // Kuning
            'HP': '#38BDF8',    // Biru Muda
            'LENOVO': '#EF4444',// Merah
            'MSI': '#F8FAFC'    // Putih (sedikit off-white agar terlihat)
        };

        const defaultColors = [
            '#8B5CF6', '#EC4899', '#06B6D4', '#F97316',
            '#14B8A6', '#84CC16', '#6366F1', '#D946EF', '#64748B'
        ];
        
        let defaultColorIndex = 0;

        const datasets = brandNames.map((brand) => {
            let color = brandColors[brand];
            if (!color) {
                color = defaultColors[defaultColorIndex % defaultColors.length];
                defaultColorIndex++;
            }
            
            return {
                label: brand,
                data: brandsData[brand],
                borderColor: color,
                backgroundColor: color,
                borderWidth: 2,
                tension: 0.3,
                pointRadius: 4,
                pointHoverRadius: 6
            };
        });

        const ctx = document.getElementById('brandChart');
        if (!ctx) return;
        
        if (window.brandChartInstance) {
            window.brandChartInstance.destroy();
        }

        const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim();

        window.brandChartInstance = new Chart(ctx.getContext('2d'), {
            type: 'line',
            data: {
                labels: dates.map(d => formatDate(d)),
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: textColor,
                            font: { family: "'Inter', sans-serif", size: 11 },
                            boxWidth: 12,
                            padding: 15
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim(),
                        titleColor: textColor,
                        bodyColor: textColor,
                        borderColor: getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim(),
                        borderWidth: 1
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim() },
                        ticks: { color: textColor }
                    },
                    x: {
                        grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim() },
                        ticks: { color: textColor }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        });
    }
};

// 10. PRICE LIST MODULE
const PriceList = {
    data: [],
    filteredData: [],
    sortColumn: 'no',
    sortDirection: 'asc',
    filters: {},
    distribusiVisible: true,

    columns: [
        { key: 'no', label: 'No.', type: 'number', width: '50px' },
        { key: 'sku', label: 'SKU', type: 'text', hidden: true },
        { key: 'pn', label: 'PN', type: 'text', hidden: true },
        { key: 'type', label: 'Type', type: 'text', hidden: true },
        { key: 'deskripsi', label: 'Deskripsi / Nama Barang', type: 'text', class: 'col-deskripsi' },
        { key: 'total', label: 'Total', type: 'number', width: '80px', class: 'col-stock' },
        { key: 'harco', label: 'Harco', type: 'number', width: '80px', class: 'col-stock' },
        { key: 'serpong', label: 'Serpong', type: 'number', class: 'col-serpong', width: '90px' },
        { key: 'distribusi', label: 'Distribusi', type: 'currency' },
        { key: 'hargaOnline', label: 'Harga Online', type: 'currency' },
        { key: 'hargaOffline', label: 'Harga Offline', type: 'currency' },
        { key: 'srp', label: 'SRP', type: 'currency' },
        { key: 'promo_sellout', label: 'Promo Sellout', type: 'text' }
    ],

    async render() {
        const dateSelect = document.getElementById('pricelist-date-select');
        let targetDate = dateSelect.value;
        if (!targetDate) {
            targetDate = await getLatestDatabaseDate();
            dateSelect.value = targetDate;
        }

        dateSelect.onchange = () => {
            this.render();
        };

        let rawData = await DB.getData(targetDate);
        let actualDateStr = targetDate;
        let isLatestFallback = false;

        if (!rawData) {
            // Fallback: cari data terbaru yang tersedia
            const latest = await DB.getLatestData();
            if (latest) {
                rawData = latest.data;
                actualDateStr = latest.date;
                isLatestFallback = true;
            } else {
                rawData = [];
            }
        }

        let prevDataObj = await DB.getPreviousData(actualDateStr);
        let prevDataMap = new Map();
        if (prevDataObj && prevDataObj.data) {
            prevDataObj.data.forEach(p => prevDataMap.set(p.deskripsi.toLowerCase(), p));
        }

        let prevDateText = prevDataObj ? formatDate(prevDataObj.date) : 'Tidak ada';
        let currentDateText = formatDate(actualDateStr) + (isLatestFallback ? ' (Terbaru)' : '');
        
        document.getElementById('pricelist-date-display').innerHTML = `
            <strong>Menampilkan:</strong> <span style="color: var(--accent);">${currentDateText}</span>
            <span style="margin: 0 10px; color: var(--border-color);">|</span>
            <span style="color: var(--text-secondary);"><strong>Dibandingkan:</strong> ${prevDateText}</span>
        `;
        this.data = rawData.map(p => {
            const prev = prevDataMap.get(p.deskripsi.toLowerCase());
            return {
                ...p,
                hargaOnline: PriceCalc.hargaOnline(p.distribusi),
                hargaOffline: PriceCalc.hargaOffline(p.distribusi),
                isNew: !prev,
                prevDistribusi: prev ? prev.distribusi : null,
                prevHargaOnline: prev ? PriceCalc.hargaOnline(prev.distribusi) : null,
                prevHargaOffline: prev ? PriceCalc.hargaOffline(prev.distribusi) : null,
                prevSerpong: prev ? prev.serpong : null,
                prevHarco: prev ? prev.harco : null,
                prevTotal: prev ? prev.total : null
            };
        });

        this.renderHeader();
        this.applyFiltersAndSort();
    },

    renderHeader() {
        const headerRow = document.getElementById('pricelist-header-row');
        const filterRow = document.getElementById('pricelist-filter-row');

        headerRow.innerHTML = '';
        filterRow.innerHTML = '';

        this.columns.forEach(col => {
            if (col.hidden) return;
            if (col.adminOnly && !Auth.isAdmin()) return;
            if (!this.distribusiVisible && col.key === 'distribusi') return;

            // Header cell
            const th = document.createElement('th');
            th.textContent = col.label;
            if (col.class) th.classList.add(col.class);
            th.style.cursor = 'pointer';
            if (col.width) {
                th.style.width = col.width;
                th.style.minWidth = col.width;
            }

            if (this.sortColumn === col.key) {
                th.innerHTML += this.sortDirection === 'asc' ? ' &uarr;' : ' &darr;';
            }

            th.onclick = () => {
                if (this.sortColumn === col.key) {
                    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    this.sortColumn = col.key;
                    this.sortDirection = 'asc';
                }
                this.applyFiltersAndSort();
                this.renderHeader();
            };
            headerRow.appendChild(th);

            // Filter cell
            const filterTh = document.createElement('th');
            if (col.class) filterTh.classList.add(col.class);
            if (col.width) {
                filterTh.style.width = col.width;
                filterTh.style.minWidth = col.width;
            }
            const searchableColumns = ['deskripsi', 'total', 'harco', 'serpong'];
            if (searchableColumns.includes(col.key)) {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'input-field column-filter';
                input.placeholder = `Filter...`;
                input.style.width = '100%';
                input.style.padding = '4px 8px';
                input.style.fontSize = '0.8rem';
                input.value = this.filters[col.key] || '';

                input.oninput = (e) => {
                    this.filters[col.key] = e.target.value;
                    this.applyFiltersAndSort();
                };

                filterTh.appendChild(input);
            }
            filterRow.appendChild(filterTh);
        });
    },

    applyFiltersAndSort() {
        this.filteredData = this.data.filter(item => {
            for (const key in this.filters) {
                const filterVal = this.filters[key].toLowerCase().trim();
                if (!filterVal) continue;

                const itemVal = String(item[key] || '').toLowerCase();
                const filterParts = filterVal.split(',').map(p => p.trim()).filter(p => p !== '');
                
                // Cek apakah semua frasa ada di itemVal
                for (const part of filterParts) {
                    if (!itemVal.includes(part)) return false;
                }
            }
            return true;
        });

        this.filteredData.sort((a, b) => {
            let valA = a[this.sortColumn];
            let valB = b[this.sortColumn];

            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        this.renderBody();
    },

    renderBody() {
        const tbody = document.getElementById('pricelist-body');
        const emptyState = document.getElementById('pricelist-empty');
        const tableWrapper = document.querySelector('#page-pricelist .table-wrapper');

        if (this.filteredData.length === 0) {
            let colCount = this.columns.filter(c => {
                if (c.adminOnly && !Auth.isAdmin()) return false;
                if (!this.distribusiVisible && c.key === 'distribusi') return false;
                return true;
            }).length;

            tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align: center; padding: 2rem; color: var(--text-muted);">Tidak ada data yang cocok dengan pencarian / filter</td></tr>`;
            tableWrapper.style.display = 'block'; // Make sure table is still visible!
            emptyState.style.display = 'none';
            return;
        }

        tableWrapper.style.display = 'block';
        emptyState.style.display = 'none';

        tbody.innerHTML = this.renderTable(this.filteredData);
        
        tbody.onclick = (e) => {
            const btnCopy = e.target.closest('.btn-copy-desc');
            if (btnCopy) {
                const text = btnCopy.dataset.copy;
                navigator.clipboard.writeText(text).then(() => {
                    showToast('Berhasil dicopy!', 'success');
                }).catch(err => {
                    showToast('Gagal copy: ' + err, 'error');
                });
                return;
            }
            
            const btnSearch = e.target.closest('.btn-search-desc');
            if (btnSearch) {
                const query = btnSearch.dataset.query;
                window.open(`https://www.google.com/search?q=${query}`, '_blank');
                return;
            }
        };
    },

    renderTable(data) {
        return data.map(item => {
            let rowHtml = '<tr>';
            this.columns.forEach(col => {
                if (col.hidden) return;
                if (col.adminOnly && !Auth.isAdmin()) return;
                if (!this.distribusiVisible && col.key === 'distribusi') return;

                let val = item[col.key];
                let displayVal = val;
                
                if (col.type === 'currency' || col.type === 'number') {
                    if (col.type === 'currency') displayVal = formatCurrency(val);
                    else displayVal = formatNumber(val);
                    
                    let prevKey = col.key === 'distribusi' ? 'prevDistribusi' : 
                                  col.key === 'hargaOnline' ? 'prevHargaOnline' : 
                                  col.key === 'hargaOffline' ? 'prevHargaOffline' : 
                                  col.key === 'serpong' ? 'prevSerpong' : 
                                  col.key === 'harco' ? 'prevHarco' : 
                                  col.key === 'total' ? 'prevTotal' : null;
                                  
                    if (prevKey && item[prevKey] !== null) {
                        let prevVal = item[prevKey];
                        if (val > prevVal) {
                            let diff = val - prevVal;
                            let diffStr = col.type === 'currency' ? formatCurrency(diff) : formatNumber(diff);
                            displayVal = `<span style="color: var(--success); font-weight: 600;">${displayVal} <small style="margin-left: 4px; font-size: 0.7em;">&#9650; +${diffStr}</small></span>`;
                        } else if (val < prevVal) {
                            let diff = prevVal - val;
                            let diffStr = col.type === 'currency' ? formatCurrency(diff) : formatNumber(diff);
                            displayVal = `<span style="color: var(--danger); font-weight: 600;">${displayVal} <small style="margin-left: 4px; font-size: 0.7em;">&#9660; -${diffStr}</small></span>`;
                        }
                    }
                }

                if (col.key === 'deskripsi') {
                    let descHtml = displayVal;
                    if (item.isNew) {
                        descHtml = `<span class="badge-new-blink">BARU</span> ` + descHtml;
                    }
                    
                    const hargaOnlineFormatted = formatCurrency(item.hargaOnline || 0);
                    // Gunakan double quotes escaped untuk mencegah masalah attribute parsing
                    const copyText = `${item.deskripsi} ${hargaOnlineFormatted}`.replace(/"/g, '&quot;');
                    const query = encodeURIComponent(item.deskripsi);
                    
                    displayVal = `${descHtml} <span style="white-space: nowrap; margin-left: 4px;">
                        <button class="btn-search-desc" data-query="${query}" title="Cari di Google" style="background:none; border:none; cursor:pointer; font-size:1.1rem; opacity:0.6; padding:0 2px;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">
                            🔍
                        </button>
                        <button class="btn-copy-desc" data-copy="${copyText}" title="Copy Deskripsi & Harga Online" style="background:none; border:none; cursor:pointer; font-size:1.1rem; opacity:0.6; padding:0 2px;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">
                            📋
                        </button>
                    </span>`;
                }

                let cls = col.class ? ` class="${col.class}"` : '';
                rowHtml += `<td${cls}>${displayVal}</td>`;
            });
            rowHtml += '</tr>';
            return rowHtml;
        }).join('');
    },

    exportToExcel() {
        if (this.filteredData.length === 0) {
            showToast('Tidak ada data untuk diexport', 'error');
            return;
        }

        const dateStr = document.getElementById('pricelist-date-select').value;
        const exportData = this.filteredData.map((item, index) => {
            const row = {};
            this.columns.forEach(col => {
                if (col.adminOnly && !Auth.isAdmin()) return;
                if (!this.distribusiVisible && col.key === 'distribusi') return;
                
                let val = item[col.key];
                if (col.key === 'no') val = index + 1; // Recalculate No. based on filter
                row[col.label] = val;
            });
            return row;
        });

        // 1. Convert to worksheet, starting at row 3 (origin A3)
        const ws = XLSX.utils.json_to_sheet(exportData, { origin: "A3" });

        // 2. Add Title at A1
        const titleText = `MASTER DATA PRICELIST - ${formatDate(dateStr)}`;
        XLSX.utils.sheet_add_aoa(ws, [[titleText]], { origin: "A1" });

        // Calculate number of visible columns
        const visibleColsCount = Object.keys(exportData[0] || {}).length;

        // 3. Merge title cells across all visible columns
        if (!ws['!merges']) ws['!merges'] = [];
        ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: visibleColsCount - 1 } });

        // 4. Formatting cells
        const range = XLSX.utils.decode_range(ws['!ref']);
        
        let maxDescWidth = 25; // default minimum width

        for (let R = range.s.r; R <= range.e.r; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
                const cell = ws[cellRef];
                if (!cell) continue;

                // Title row styling
                if (R === 0) {
                    cell.s = {
                        font: { bold: true, sz: 14, color: { rgb: "FFFFFF" } },
                        fill: { fgColor: { rgb: "1a2238" } },
                        alignment: { horizontal: "center", vertical: "center" }
                    };
                }

                // Header row styling (row 3 is index 2)
                if (R === 2) {
                    cell.s = {
                        font: { bold: true, color: { rgb: "FFFFFF" } },
                        fill: { fgColor: { rgb: "2a3754" } },
                        alignment: { horizontal: "center", vertical: "center" }
                    };
                }

                const headerCell = ws[XLSX.utils.encode_cell({ r: 2, c: C })];
                
                // Calculate max width for Description
                if (headerCell && headerCell.v === 'Deskripsi / Nama Barang' && R >= 3) {
                    if (cell.v && String(cell.v).length > maxDescWidth) {
                        maxDescWidth = String(cell.v).length;
                    }
                }

                // Numeric formats for prices and stock
                if (R >= 3 && cell.t === 'n' && headerCell) {
                    const h = headerCell.v;
                    if (h.includes('Harga') || h === 'Distribusi' || h === 'SRP' || h === 'Total' || h === 'Harco' || h === 'Serpong') {
                        cell.z = '#,##0'; // format number with thousand separator
                    }
                }
            }
        }

        // 5. Adjust column widths
        ws['!cols'] = [];
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const headerCell = ws[XLSX.utils.encode_cell({ r: 2, c: C })];
            if (headerCell && headerCell.v === 'No.') {
                ws['!cols'].push({ wch: 5 });
            } else if (headerCell && headerCell.v === 'Deskripsi / Nama Barang') {
                ws['!cols'].push({ wch: Math.min(maxDescWidth + 2, 120) }); // cap at 120
            } else if (headerCell && (headerCell.v.includes('Harga') || headerCell.v === 'Distribusi' || headerCell.v === 'SRP')) {
                ws['!cols'].push({ wch: 15 });
            } else {
                ws['!cols'].push({ wch: 10 }); // stocks and hidden cols like SKU
            }
        }

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "PriceList");

        XLSX.writeFile(wb, `Vicmic_PriceList_${dateStr}.xlsx`);
    }
};

// 11. REPORTS MODULE
const Reports = {
    async render() {
        const dateStr = await getLatestDatabaseDate();
        document.getElementById('reports-date-label').textContent = formatDate(dateStr);

        const dataObj = await DB.getData(dateStr);
        const prevDataObj = await DB.getPreviousData(dateStr);

        const data = dataObj || [];
        const prevData = prevDataObj ? prevDataObj.data : [];

        this.renderNewItems(data, prevData);
        this.renderOutOfStock(data, prevData);

        // Setup tabs
        document.querySelectorAll('.report-tab').forEach(tab => {
            tab.onclick = () => {
                document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.report-content').forEach(c => c.classList.remove('active'));

                tab.classList.add('active');
                const contentId = tab.dataset.tab === 'new' ? 'report-new-items' : 'report-out-of-stock';
                document.getElementById(contentId).classList.add('active');
            };
        });
    },

    renderNewItems(data, prevData) {
        const prevSet = new Set(prevData.map(p => p.deskripsi.toLowerCase()));
        const newItems = data.filter(p => !prevSet.has(p.deskripsi.toLowerCase()));

        const tbody = document.querySelector('#new-items-table tbody');

        document.querySelector('#new-items-table thead tr').innerHTML = `
            <th style="width: 50px;">No.</th>
            <th style="white-space: normal; text-align: left; min-width: 200px;">Nama Barang (Baru)</th>
            <th style="width: 100px; text-align: right;">Stok Total</th>
        `;

        if (newItems.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center">Tidak ada barang baru hari ini</td></tr>';
            return;
        }

        tbody.innerHTML = newItems.map((item, i) => `
            <tr>
                <td>${i + 1}</td>
                <td style="white-space: normal; text-align: left;"><span class="badge-new-blink">BARU</span> ${item.deskripsi}</td>
                <td style="text-align: right; font-weight: 600;">${item.total || 0}</td>
            </tr>
        `).join('');
    },

    renderOutOfStock(data, prevData) {
        const currSet = new Set(data.map(p => p.deskripsi.toLowerCase()));
        const oosItems = prevData.filter(p => !currSet.has(p.deskripsi.toLowerCase()));

        const tbody = document.querySelector('#oos-table tbody');
        document.querySelector('#oos-table thead tr').innerHTML = `
            <th style="width: 50px;">No.</th>
            <th style="white-space: normal; text-align: left; min-width: 200px;">Nama Barang (Habis / Hilang)</th>
        `;

        if (oosItems.length === 0) {
            tbody.innerHTML = '<tr><td colspan="2" style="text-align:center">Tidak ada barang yang habis / hilang hari ini</td></tr>';
            return;
        }

        tbody.innerHTML = oosItems.map((item, i) => `
            <tr class="row-danger">
                <td>${i + 1}</td>
                <td style="color: var(--danger); font-weight: 500; white-space: normal; text-align: left;">${item.deskripsi}</td>
            </tr>
        `).join('');
    }
};

// 12. USER MANAGEMENT MODULE
const UserManagement = {
    async render() {
        await this.renderTable();
        const form = document.getElementById('add-user-form');
        form.onsubmit = async (e) => {
            e.preventDefault();
            const email = document.getElementById('input-user-email').value.trim();
            const role = document.getElementById('select-user-role').value;

            if (!email) return;

            if (await DB.findUser(email)) {
                showToast('Email sudah terdaftar', 'error');
                return;
            }

            const success = await DB.addUser(email, role, Auth.currentUser.email);
            if (success) {
                showToast('User berhasil ditambahkan', 'success');
                document.getElementById('input-user-email').value = '';
                await this.renderTable();
            }
        };
    },

    async renderTable() {
        const tbody = document.getElementById('users-table-body');
        const users = await DB.getUsers();

        tbody.innerHTML = users.map(u => `
            <tr>
                <td>${u.email} ${u.isSuperAdmin ? '<span class="badge badge-admin">SUPER ADMIN</span>' : ''}</td>
                <td><span class="user-role-badge badge-${u.role}">${u.role.toUpperCase()}</span></td>
                <td>${u.addedBy || '-'}</td>
                <td>${formatDate(u.addedAt)}</td>
                <td>
                    ${!u.isSuperAdmin ? `
                        <button class="btn btn-sm btn-secondary btn-edit-user" data-email="${u.email}" data-role="${u.role}">Edit</button>
                        <button class="btn btn-sm btn-danger btn-delete-user" data-email="${u.email}">Hapus</button>
                    ` : ''}
                </td>
            </tr>
        `).join('');

        document.querySelectorAll('.btn-delete-user').forEach(btn => {
            btn.onclick = async () => {
                const email = btn.dataset.email;
                if (confirm(`Yakin ingin menghapus akses untuk ${email}?`)) {
                    await DB.removeUser(email);
                    showToast('User dihapus', 'success');
                    await this.renderTable();
                }
            };
        });

        document.querySelectorAll('.btn-edit-user').forEach(btn => {
            btn.onclick = (e) => {
                const tr = e.target.closest('tr');
                const email = btn.dataset.email;
                const role = btn.dataset.role;
                
                tr.innerHTML = `
                    <td><input type="email" class="input-field edit-email" value="${email}" style="width: 100%; padding: 4px;"></td>
                    <td>
                        <select class="input-field edit-role" style="width: 100%; padding: 4px;">
                            <option value="sales" ${role === 'sales' ? 'selected' : ''}>Sales</option>
                            <option value="sales_kurir" ${role === 'sales_kurir' ? 'selected' : ''}>Sales + Kurir</option>
                            <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option>
                        </select>
                    </td>
                    <td>-</td>
                    <td>-</td>
                    <td style="white-space: nowrap;">
                        <button class="btn btn-sm btn-primary btn-save-user" data-old-email="${email}">Save</button>
                        <button class="btn btn-sm btn-secondary btn-cancel-edit">Batal</button>
                    </td>
                `;
                
                tr.querySelector('.btn-cancel-edit').onclick = () => this.renderTable();
                tr.querySelector('.btn-save-user').onclick = async (e2) => {
                    const oldEmail = e2.target.dataset.oldEmail;
                    const newEmail = tr.querySelector('.edit-email').value.trim();
                    const newRole = tr.querySelector('.edit-role').value;
                    if (!newEmail) return;
                    
                    const success = await DB.updateUser(oldEmail, newEmail, newRole);
                    if (success) {
                        showToast('User berhasil diupdate', 'success');
                        this.renderTable();
                    }
                };
            };
        });
    }
};

// 13. UPLOAD MODULE
const Upload = {
    selectedFile: null,

    async render() {
        const tzOffset = new Date().getTimezoneOffset() * 60000;
        document.getElementById('upload-date').value = new Date(Date.now() - tzOffset).toISOString().split('T')[0];
        await this.renderHistory();
    },

    async renderHistory() {
        const tbody = document.getElementById('upload-history-body');
        if (!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Memuat riwayat...</td></tr>';
        
        try {
            let dates = await DB.getAvailableDates();
            
            const startDate = document.getElementById('filter-start-date')?.value;
            const endDate = document.getElementById('filter-end-date')?.value;
            
            if (startDate) {
                dates = dates.filter(d => d >= startDate);
            }
            if (endDate) {
                dates = dates.filter(d => d <= endDate);
            }

            if (dates.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-muted);">Belum ada data yang diupload</td></tr>';
                return;
            }

            const meta = JSON.parse(localStorage.getItem('upload_metadata') || '{}');
            tbody.innerHTML = dates.map(date => `
                <tr>
                    <td style="text-align: center;"><input type="checkbox" class="chk-delete-row" value="${date}"></td>
                    <td style="font-weight: 500;">${formatDate(date)}</td>
                    <td style="color: var(--text-muted); font-size: 0.9em;">${meta[date] ? meta[date].filename : '-'}</td>
                    <td><span class="badge badge-success" style="background: var(--success); color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.8em;">Tersedia</span></td>
                    <td>
                        <button class="btn btn-sm btn-danger btn-delete-history" data-date="${date}">Hapus</button>
                    </td>
                </tr>
            `).join('');

            // Checkbox logic
            const chkSelectAll = document.getElementById('chk-select-all');
            const chkRows = document.querySelectorAll('.chk-delete-row');
            const btnBulkDelete = document.getElementById('btn-bulk-delete');
            
            const updateBulkButton = () => {
                const anyChecked = Array.from(chkRows).some(chk => chk.checked);
                if (btnBulkDelete) btnBulkDelete.style.display = anyChecked ? 'inline-block' : 'none';
            };
            
            if (chkSelectAll) {
                chkSelectAll.checked = false;
                chkSelectAll.onchange = (e) => {
                    chkRows.forEach(chk => chk.checked = e.target.checked);
                    updateBulkButton();
                };
            }
            
            chkRows.forEach(chk => {
                chk.onchange = () => {
                    if (!chk.checked && chkSelectAll) chkSelectAll.checked = false;
                    updateBulkButton();
                };
            });
            
            if (btnBulkDelete) {
                btnBulkDelete.onclick = async () => {
                    const selectedDates = Array.from(chkRows).filter(chk => chk.checked).map(chk => chk.value);
                    if (selectedDates.length === 0) return;
                    
                    if (confirm(`Yakin ingin menghapus ${selectedDates.length} riwayat data terpilih secara permanen?`)) {
                        btnBulkDelete.disabled = true;
                        btnBulkDelete.innerText = 'Menghapus...';
                        try {
                            for (const date of selectedDates) {
                                await DB.deleteData(date);
                                const m = JSON.parse(localStorage.getItem('upload_metadata') || '{}');
                                if (m[date]) {
                                    delete m[date];
                                    localStorage.setItem('upload_metadata', JSON.stringify(m));
                                }
                            }
                            showToast(`${selectedDates.length} data terpilih berhasil dihapus`, 'success');
                            await Upload.renderHistory();
                            await Dashboard.render();
                        } catch(err) {
                            showToast('Gagal menghapus sebagian data', 'error');
                        } finally {
                            btnBulkDelete.disabled = false;
                            btnBulkDelete.innerText = '🗑️ Hapus Terpilih';
                            btnBulkDelete.style.display = 'none';
                        }
                    }
                };
            }

            document.querySelectorAll('.btn-delete-history').forEach(btn => {
                let countdownInterval = null;
                let countdownValue = 5;
                let isConfirming = false;
                
                btn.onclick = async (e) => {
                    const dateStr = e.target.dataset.date;
                    
                    if (!isConfirming) {
                        isConfirming = true;
                        countdownValue = 5;
                        e.target.innerText = `Ya (${countdownValue})`;
                        
                        // Create cancel button next to it
                        const cancelBtn = document.createElement('button');
                        cancelBtn.className = 'btn btn-sm btn-secondary';
                        cancelBtn.innerText = 'Batal';
                        cancelBtn.style.marginLeft = '5px';
                        cancelBtn.onclick = (ev) => {
                            ev.stopPropagation();
                            clearInterval(countdownInterval);
                            isConfirming = false;
                            e.target.innerText = 'Hapus';
                            cancelBtn.remove();
                        };
                        e.target.parentNode.appendChild(cancelBtn);

                        countdownInterval = setInterval(() => {
                            countdownValue--;
                            if (countdownValue > 0) {
                                e.target.innerText = `Ya (${countdownValue})`;
                            } else {
                                clearInterval(countdownInterval);
                                e.target.innerText = `Yakin? Hapus!`;
                            }
                        }, 1000);
                    } else if (countdownValue <= 0) {
                        isConfirming = false;
                        // Remove cancel button if exists
                        if (e.target.nextSibling) {
                            e.target.nextSibling.remove();
                        }
                        
                        try {
                            e.target.disabled = true;
                            e.target.innerText = 'Menghapus...';
                            await DB.deleteData(dateStr);
                            showToast(`Data tanggal ${formatDate(dateStr)} berhasil dihapus`, 'success');
                            await Upload.renderHistory();
                            await Dashboard.render();
                        } catch (err) {
                            showToast('Gagal menghapus data: ' + err.message, 'error');
                            e.target.disabled = false;
                            e.target.innerText = 'Hapus';
                        }
                    }
                };
            });

        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color: var(--danger);">Gagal memuat riwayat: ${err.message}</td></tr>`;
        }
    },

    init() {
        const dropzone = document.getElementById('upload-dropzone');
        const fileInput = document.getElementById('file-input');
        const btnUpload = document.getElementById('btn-upload');
        const dateInput = document.getElementById('upload-date');
        
        const tzOffset = new Date().getTimezoneOffset() * 60000;
        dateInput.value = new Date(Date.now() - tzOffset).toISOString().split('T')[0];

        dropzone.onclick = () => fileInput.click();

        dropzone.ondragover = (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'var(--primary-color)';
        };

        dropzone.ondragleave = () => {
            dropzone.style.borderColor = '';
        };

        dropzone.ondrop = (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '';
            if (e.dataTransfer.files.length) {
                this.onFileSelected(e.dataTransfer.files[0]);
            }
        };

        fileInput.onchange = (e) => {
            if (e.target.files.length) {
                this.onFileSelected(e.target.files[0]);
            }
        };

        btnUpload.onclick = () => this.processUpload();
        
        const btnFilter = document.getElementById('btn-filter-history');
        if (btnFilter) {
            btnFilter.onclick = () => this.renderHistory();
        }
        
        const btnReset = document.getElementById('btn-reset-history');
        if (btnReset) {
            btnReset.onclick = () => {
                document.getElementById('filter-start-date').value = '';
                document.getElementById('filter-end-date').value = '';
                this.renderHistory();
            };
        }
    },

    onFileSelected(file) {
        this.selectedFile = file;
        const status = document.getElementById('upload-status');
        status.innerHTML = `<span style="color:var(--success-color)">File terpilih: ${file.name}</span>`;
        document.getElementById('btn-upload').disabled = false;
    },

    async processUpload() {
        const dateStr = document.getElementById('upload-date').value;
        if (!dateStr) {
            showToast('Pilih tanggal berlaku', 'error');
            return;
        }

        if (isSunday(dateStr)) {
            showToast('Tidak bisa upload untuk hari Minggu!', 'error');
            return;
        }

        if (!this.selectedFile) {
            showToast('Pilih file terlebih dahulu', 'error');
            return;
        }

        try {
            document.getElementById('btn-upload').disabled = true;
            document.getElementById('upload-status').innerHTML = 'Memproses...';

            const products = await ExcelParser.parse(this.selectedFile);
            await DB.saveData(dateStr, products);
            
            const meta = JSON.parse(localStorage.getItem('upload_metadata') || '{}');
            meta[dateStr] = { filename: this.selectedFile.name };
            localStorage.setItem('upload_metadata', JSON.stringify(meta));

            showToast(`Berhasil menyimpan ${products.length} produk`, 'success');
            document.getElementById('upload-status').innerHTML = '';
            this.selectedFile = null;
            document.getElementById('file-input').value = '';

            await Dashboard.render();
            await this.renderHistory();

        } catch (err) {
            showToast(err, 'error');
            document.getElementById('upload-status').innerHTML = `<span style="color:var(--danger-color)">${err}</span>`;
        } finally {
            document.getElementById('btn-upload').disabled = !this.selectedFile;
        }
    }
};

const Courier = {
    cache: {},
    typingTimeout: null,
    currentFromCoords: null,
    currentToCoords: null,
    
    init() {
        const fromInput = document.getElementById('courier-from');
        const toInput = document.getElementById('courier-to');
        const dateInput = document.getElementById('courier-date');
        const timeInput = document.getElementById('courier-time');
        
        if (!fromInput) return; // not loaded
        
        // set default datetime
        const now = new Date();
        dateInput.value = now.toISOString().split('T')[0];
        timeInput.value = now.toTimeString().substring(0,5);

        fromInput.addEventListener('input', (e) => this.handleInput(e, 'from'));
        toInput.addEventListener('input', (e) => this.handleInput(e, 'to'));
        
        document.getElementById('courier-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveLog();
        });

        // Hide autocomplete when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#courier-from') && !e.target.closest('#autocomplete-from')) {
                document.getElementById('autocomplete-from').classList.add('hidden');
            }
            if (!e.target.closest('#courier-to') && !e.target.closest('#autocomplete-to')) {
                document.getElementById('autocomplete-to').classList.add('hidden');
            }
        });
    },

    async handleInput(e, type) {
        const query = e.target.value.trim();
        const dropdown = document.getElementById(`autocomplete-${type}`);
        
        if (query.length < 3) {
            dropdown.classList.add('hidden');
            if (type === 'from') this.currentFromCoords = null;
            if (type === 'to') this.currentToCoords = null;
            this.updateDistance();
            return;
        }

        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => this.searchLocation(query, type), 500);
    },

    async searchLocation(query, type) {
        const dropdown = document.getElementById(`autocomplete-${type}`);
        dropdown.innerHTML = `<div class="autocomplete-item loading">Mencari...</div>`;
        dropdown.classList.remove('hidden');

        try {
            // Check cache
            let data = this.cache[query];
            if (!data) {
                const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=id&limit=5`);
                data = await res.json();
                this.cache[query] = data;
            }

            dropdown.innerHTML = '';
            if (data.length === 0) {
                dropdown.innerHTML = `<div class="autocomplete-item">Tidak ditemukan</div>`;
                return;
            }

            data.forEach(item => {
                const div = document.createElement('div');
                div.className = 'autocomplete-item';
                div.textContent = item.display_name;
                div.onclick = () => this.selectLocation(item, type);
                dropdown.appendChild(div);
            });
        } catch (error) {
            console.error('Nominatim error:', error);
            dropdown.innerHTML = `<div class="autocomplete-item">Terjadi kesalahan</div>`;
        }
    },

    selectLocation(item, type) {
        const input = document.getElementById(`courier-${type}`);
        const dropdown = document.getElementById(`autocomplete-${type}`);
        
        input.value = item.display_name;
        dropdown.classList.add('hidden');

        if (type === 'from') {
            this.currentFromCoords = { lat: item.lat, lon: item.lon };
        } else {
            this.currentToCoords = { lat: item.lat, lon: item.lon };
        }

        this.updateDistance();
    },

    async updateDistance() {
        const distEl = document.getElementById('courier-distance');
        const rewardEl = document.getElementById('courier-reward');
        const btnSave = document.getElementById('btn-save-courier');

        if (!this.currentFromCoords || !this.currentToCoords) {
            distEl.textContent = '0 KM';
            rewardEl.textContent = 'Rp 0';
            btnSave.disabled = true;
            return;
        }

        distEl.textContent = 'Menghitung...';
        btnSave.disabled = true;

        try {
            // OSRM coordinates format: lon,lat
            const coordsStr = `${this.currentFromCoords.lon},${this.currentFromCoords.lat};${this.currentToCoords.lon},${this.currentToCoords.lat}`;
            const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=false`);
            const data = await res.json();

            if (data.code !== 'Ok') throw new Error(data.message);

            const distanceMeters = data.routes[0].distance;
            const distanceKm = (distanceMeters / 1000).toFixed(2);
            const reward = Math.round(distanceKm * 300);

            distEl.textContent = `${distanceKm} KM`;
            distEl.dataset.km = distanceKm;
            rewardEl.textContent = formatCurrency(reward);
            rewardEl.dataset.rp = reward;
            
            btnSave.disabled = false;
        } catch (error) {
            console.error('OSRM error:', error);
            distEl.textContent = 'Gagal';
            rewardEl.textContent = '-';
        }
    },

    async saveLog() {
        const distEl = document.getElementById('courier-distance');
        const rewardEl = document.getElementById('courier-reward');
        
        const log = {
            user_email: Auth.currentUser.email,
            date: document.getElementById('courier-date').value,
            time: document.getElementById('courier-time').value,
            from_location: document.getElementById('courier-from').value,
            to_location: document.getElementById('courier-to').value,
            distance_km: parseFloat(distEl.dataset.km),
            amount_rp: parseInt(rewardEl.dataset.rp)
        };

        const btn = document.getElementById('btn-save-courier');
        btn.disabled = true;
        btn.textContent = 'Menyimpan...';

        try {
            const { error } = await window.supabaseClient.from('courier_logs').insert([log]);
            if (error) throw error;
            
            showToast('Log perjalanan berhasil disimpan!', 'success');
            
            // reset form
            document.getElementById('courier-from').value = '';
            document.getElementById('courier-to').value = '';
            this.currentFromCoords = null;
            this.currentToCoords = null;
            this.updateDistance();
            
            this.loadLogs(); // refresh table
        } catch (e) {
            console.error('Save log error:', e);
            showToast('Gagal menyimpan log: ' + e.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Simpan Log Perjalanan';
        }
    },

    async loadLogs() {
        const tbody = document.getElementById('courier-table-body');
        if (!tbody) return;

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        
        let query = window.supabaseClient.from('courier_logs')
            .select('*')
            .gte('date', startOfMonth)
            .order('date', { ascending: false })
            .order('time', { ascending: false });

        if (!Auth.isAdmin()) {
            query = query.eq('user_email', Auth.currentUser.email);
        }

        const { data, error } = await query;

        if (error) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger);">Gagal memuat data</td></tr>`;
            return;
        }

        let totalKm = 0;
        let totalRp = 0;

        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center;">Belum ada log perjalanan bulan ini</td></tr>`;
        } else {
            tbody.innerHTML = data.map(log => {
                totalKm += log.distance_km;
                totalRp += log.amount_rp;
                
                return `
                <tr>
                    <td>${log.date} <span style="color:var(--text-muted);font-size:0.9em">${log.time}</span><br>
                        <small style="color:var(--accent)">${Auth.isAdmin() ? log.user_email : ''}</small>
                    </td>
                    <td><div style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${log.from_location}">${log.from_location}</div></td>
                    <td><div style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${log.to_location}">${log.to_location}</div></td>
                    <td>${log.distance_km} KM</td>
                    <td style="color: var(--success);">${formatCurrency(log.amount_rp)}</td>
                    <td>
                        <button class="btn btn-sm btn-danger" onclick="Courier.deleteLog('${log.id}')">Hapus</button>
                    </td>
                </tr>
                `;
            }).join('');
        }

        document.getElementById('rekap-jarak').textContent = `${totalKm.toFixed(2)} KM`;
        document.getElementById('rekap-komisi').textContent = formatCurrency(totalRp);
    },
    
    async deleteLog(id) {
        if (!confirm('Hapus log perjalanan ini?')) return;
        const { error } = await window.supabaseClient.from('courier_logs').delete().eq('id', id);
        if (error) {
            showToast('Gagal menghapus log', 'error');
        } else {
            showToast('Log berhasil dihapus', 'success');
            this.loadLogs();
        }
    }
};

// 14. APP INITIALIZATION
document.addEventListener('DOMContentLoaded', async () => {
    // Theme Management
    const savedTheme = localStorage.getItem('vicmic_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
        themeSelect.value = savedTheme;
        themeSelect.addEventListener('change', (e) => {
            const theme = e.target.value;
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('vicmic_theme', theme);
            
            // Re-render chart if it exists on dashboard
            const dateInput = document.getElementById('brand-chart-date');
            if (window.brandChartInstance && dateInput) {
                App.renderBrandChart(dateInput.value);
            }
        });
    }

    // Cleanup old data on load (> 60 days)
    await DB.cleanupOldData(60);

    // Mobile Collapsible Cards
    document.querySelectorAll('.mobile-collapsible').forEach(header => {
        header.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                // Jangan collapse kalau klik elemen select (chart timeframe)
                if (e.target.tagName.toLowerCase() === 'select' || e.target.tagName.toLowerCase() === 'option') {
                    return;
                }
                header.classList.toggle('collapsed');
            }
        });
    });

    if (window.Courier) Courier.init();

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => console.error('SW:', err));
    }

    // Modal close handlers
    document.getElementById('btn-modal-close').addEventListener('click', hideModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'modal-overlay') hideModal();
    });

    // Mobile menu toggle
    document.getElementById('mobile-menu-toggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
        document.getElementById('sidebar-overlay').classList.toggle('show');
    });
    document.getElementById('sidebar-overlay').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebar-overlay').classList.remove('show');
    });

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

    // Hide Distribusi Toggle
    document.getElementById('btn-toggle-distribusi').addEventListener('click', (e) => {
        PriceList.distribusiVisible = !PriceList.distribusiVisible;
        e.target.innerHTML = PriceList.distribusiVisible ? '👁️ Hide Distribusi' : '👁️ Show Distribusi';
        PriceList.renderHeader();
        PriceList.renderBody();
    });

    // Export
    document.getElementById('btn-export').addEventListener('click', () => PriceList.exportToExcel());

    // Upload init
    Upload.init();

    // Initialize Auth
    Auth.init();
});
