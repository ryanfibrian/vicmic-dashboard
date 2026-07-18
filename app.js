// 1. CONFIG & CONSTANTS
const CONFIG = {
    GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID',
    STORAGE_KEYS: {
        USERS: 'vicmic_users',
        DATA_PREFIX: 'vicmic_data_'
    },
    COLUMN_ALIASES: {
        distribusi: ['distribusi', 'harga dist', 'harga modal'],
        serpong: ['serpong', 'stok serpong', 'cabang serpong'],
        harco: ['harco', 'stok harco', 'cabang harco'],
        total: ['total', 'total stok', 'stok global'],
        deskripsi: ['new deskripsi', 'deskripsi', 'nama barang', 'item']
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

function decodeJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch(e) {
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

// 4. DATABASE MODULE (DB object)
const DB = {
    getUsers() { return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.USERS) || '[]'); },
    saveUsers(users) { localStorage.setItem(CONFIG.STORAGE_KEYS.USERS, JSON.stringify(users)); },
    addUser(email, role, addedBy) {
        const users = this.getUsers();
        users.push({ email: email.toLowerCase(), role, addedBy, addedAt: dateToKey(new Date()) });
        this.saveUsers(users);
    },
    removeUser(email) {
        const users = this.getUsers().filter(u => u.email !== email.toLowerCase());
        this.saveUsers(users);
    },
    findUser(email) { return this.getUsers().find(u => u.email === email.toLowerCase()); },
    
    saveData(dateStr, products) {
        localStorage.setItem(CONFIG.STORAGE_KEYS.DATA_PREFIX + dateStr, JSON.stringify(products));
    },
    getData(dateStr) {
        const d = localStorage.getItem(CONFIG.STORAGE_KEYS.DATA_PREFIX + dateStr);
        return d ? JSON.parse(d) : null;
    },
    getAllDates() {
        return Object.keys(localStorage)
            .filter(k => k.startsWith(CONFIG.STORAGE_KEYS.DATA_PREFIX))
            .map(k => k.replace(CONFIG.STORAGE_KEYS.DATA_PREFIX, ''))
            .sort((a, b) => b.localeCompare(a)); // newest first
    },
    getLatestData() {
        const dates = this.getAllDates();
        if (dates.length === 0) return null;
        return { date: dates[0], data: this.getData(dates[0]) };
    },
    getPreviousData(currentDateStr) {
        // Get the most recent data BEFORE currentDateStr (Sundays are already excluded since we never store Sunday data)
        const dates = this.getAllDates().filter(d => d < currentDateStr);
        if (dates.length === 0) return null;
        return { date: dates[0], data: this.getData(dates[0]) };
    }
};

// 5. AUTH MODULE (Auth object)
const Auth = {
    currentUser: null,
    
    init() {
        // Check existing session in sessionStorage
        const saved = sessionStorage.getItem('vicmic_session');
        if (saved) {
            this.currentUser = JSON.parse(saved);
            if (this.verifyUser(this.currentUser.email)) {
                this.onLoginSuccess();
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
            google.accounts.id.initialize({
                client_id: CONFIG.GOOGLE_CLIENT_ID,
                callback: (response) => this.handleCredentialResponse(response)
            });
            google.accounts.id.renderButton(
                document.getElementById('google-signin-btn'),
                { theme: 'filled_blue', size: 'large', width: 300, text: 'signin_with', shape: 'rectangular' }
            );
        } catch(e) {
            console.warn('Google Sign-In init failed, using demo mode:', e);
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
        document.getElementById('btn-demo-login').addEventListener('click', () => {
            const email = document.getElementById('demo-email').value.trim();
            const name = document.getElementById('demo-name').value.trim() || email.split('@')[0];
            if (!email) { showToast('Masukkan email!', 'error'); return; }
            this.processLogin(email, name, '');
        });
        // Also support Enter key
        ['demo-email', 'demo-name'].forEach(id => {
            document.getElementById(id)?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') document.getElementById('btn-demo-login').click();
            });
        });
    },
    
    handleCredentialResponse(response) {
        const payload = decodeJwt(response.credential);
        this.processLogin(payload.email, payload.name, payload.picture);
    },
    
    processLogin(email, name, picture) {
        email = email.toLowerCase();
        const users = DB.getUsers();
        
        // First user EVER = Super Admin
        if (users.length === 0) {
            DB.addUser(email, 'admin', 'system');
            const u = DB.getUsers();
            u[0].isSuperAdmin = true;
            DB.saveUsers(u);
            showToast(`${name}, Anda terdaftar sebagai Super Admin!`, 'success');
        }
        
        const user = DB.findUser(email);
        if (!user) {
            document.getElementById('login-error').textContent = 'Email Anda belum terdaftar. Hubungi Admin.';
            showToast('Akses ditolak: Email belum di-whitelist', 'error');
            return;
        }
        
        this.currentUser = { email, name, picture, role: user.role, isSuperAdmin: user.isSuperAdmin || false };
        sessionStorage.setItem('vicmic_session', JSON.stringify(this.currentUser));
        this.onLoginSuccess();
    },
    
    onLoginSuccess() {
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
        
        if (this.currentUser.role === 'sales') {
            document.body.classList.add('role-sales');
        } else {
            document.body.classList.remove('role-sales');
        }
        
        Router.init();
    },
    
    verifyUser(email) { return !!DB.findUser(email.toLowerCase()); },
    isAdmin() { return this.currentUser && this.currentUser.role === 'admin'; },
    isSales() { return this.currentUser && this.currentUser.role === 'sales'; },
    
    logout() {
        this.currentUser = null;
        sessionStorage.removeItem('vicmic_session');
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
        
        // Guard: Sales can only see pricelist
        if (Auth.isSales() && page !== 'pricelist') {
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
    
    renderPage(page) {
        switch (page) {
            case 'dashboard': Dashboard.render(); break;
            case 'pricelist': PriceList.render(); break;
            case 'reports': Reports.render(); break;
            case 'users': UserManagement.render(); break;
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
            deskripsi: String(row[mapping.deskripsi] || '').trim(),
            distribusi: parseFloat(String(row[mapping.distribusi]).replace(/[^0-9.-]/g, '')) || 0,
            serpong: parseInt(String(row[mapping.serpong]).replace(/[^0-9-]/g, '')) || 0,
            harco: parseInt(String(row[mapping.harco]).replace(/[^0-9-]/g, '')) || 0,
            total: parseInt(String(row[mapping.total]).replace(/[^0-9-]/g, '')) || 0
        })).filter(p => p.deskripsi !== '');
    }
};

// 8. PRICE CALCULATOR
const PriceCalc = {
    hargaOnline(h) {
        if (!h || h <= 0) return 0;
        const base = h * 1.015;
        let raw;
        if ((base + 106310) / 0.9125 > 16250000) {
            raw = (base + 1250 + 5060 + 650000 + 60000) / 0.9525;
        } else {
            raw = (base + 1250 + 5060 + 60000) / 0.9125;
        }
        return Math.ceil(raw / 10000) * 10000 - 2000;
    },
    hargaOffline(h) {
        if (!h || h <= 0) return 0;
        return Math.round(h * 1.11);
    }
};

// 9. DASHBOARD MODULE
const Dashboard = {
    render() {
        const currentDateStr = document.getElementById('upload-date').value || getEffectiveDate();
        document.getElementById('upload-date').value = currentDateStr;
        document.getElementById('dashboard-date-label').textContent = formatDate(currentDateStr);
        
        let dataObj = DB.getData(currentDateStr);
        let prevDataObj = DB.getPreviousData(currentDateStr);
        
        const data = dataObj || [];
        const prevData = prevDataObj ? prevDataObj.data : [];
        
        this.renderKPIs(data, prevData);
        this.renderPriceAlerts(data, prevData);
        this.renderStockUrgency(data, currentDateStr);
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
        
        alerts.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
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
    
    renderStockUrgency(data, currentDateStr) {
        const container = document.getElementById('stock-urgency-list');
        const dates = DB.getAllDates().filter(d => d <= currentDateStr).slice(0, 7);
        if (dates.length < 2) {
            container.innerHTML = '<div class="empty-state">Belum ada data historis yang cukup</div>';
            return;
        }
        
        const histories = dates.map(d => DB.getData(d));
        const urgencies = [];
        
        data.forEach(p => {
            const desc = p.deskripsi.toLowerCase();
            let totalDecrease = 0;
            let decreaseDays = 0;
            
            for (let i = 0; i < histories.length - 1; i++) {
                const currentDayData = histories[i];
                const prevDayData = histories[i+1];
                if (!currentDayData || !prevDayData) continue;
                
                const currentItem = currentDayData.find(item => item.deskripsi.toLowerCase() === desc);
                const prevItem = prevDayData.find(item => item.deskripsi.toLowerCase() === desc);
                
                if (currentItem && prevItem) {
                    if (prevItem.total > currentItem.total) {
                        totalDecrease += (prevItem.total - currentItem.total);
                        decreaseDays++;
                    }
                }
            }
            
            const dailyRate = decreaseDays > 0 ? totalDecrease / decreaseDays : 0;
            const daysLeft = dailyRate > 0 ? p.total / dailyRate : Infinity;
            
            let status = 'safe';
            let label = 'STOK AMAN';
            let color = 'var(--success-color)';
            
            if (p.total === 0 || daysLeft < 3) {
                status = 'restock';
                label = 'RE-STOCK NOW';
                color = 'var(--danger-color)';
            } else if (daysLeft <= 14) {
                status = 'critical';
                label = 'STOK KRITIS';
                color = 'var(--warning-color)';
            }
            
            if (status !== 'safe') {
                urgencies.push({
                    deskripsi: p.deskripsi,
                    total: p.total,
                    dailyRate,
                    daysLeft,
                    status,
                    label,
                    color
                });
            }
        });
        
        urgencies.sort((a, b) => {
            if (a.status === 'restock' && b.status !== 'restock') return -1;
            if (b.status === 'restock' && a.status !== 'restock') return 1;
            return a.daysLeft - b.daysLeft;
        });
        
        if (urgencies.length === 0) {
            container.innerHTML = '<div class="empty-state">Semua stok aman</div>';
            return;
        }
        
        container.innerHTML = `<div class="alert-count">${urgencies.length} produk perlu perhatian</div>` +
            urgencies.slice(0, 30).map(u => 
                `<div class="stock-item">
                    <div class="stock-info">
                        <span class="stock-name">${u.deskripsi}</span>
                        <span class="stock-detail">Stok: ${formatNumber(u.total)} | ~${u.dailyRate.toFixed(1)}/hari | Est. ${u.daysLeft === Infinity ? '∞' : Math.floor(u.daysLeft)} hari</span>
                    </div>
                    <span class="badge badge-${u.status}">${u.label}</span>
                </div>`
            ).join('');
    }
};

// 10. PRICE LIST MODULE
const PriceList = {
    data: [],
    filteredData: [],
    sortColumn: 'no',
    sortDirection: 'asc',
    filters: {},
    
    columns: [
        { key: 'no', label: 'No.', type: 'number' },
        { key: 'deskripsi', label: 'Deskripsi / Nama Barang', type: 'text' },
        { key: 'distribusi', label: 'Distribusi', type: 'currency' },
        { key: 'serpong', label: 'Serpong', type: 'number', class: 'col-serpong' },
        { key: 'harco', label: 'Harco', type: 'number' },
        { key: 'total', label: 'Total', type: 'number' },
        { key: 'hargaOnline', label: 'Harga Online', type: 'currency' },
        { key: 'hargaOffline', label: 'Harga Offline', type: 'currency' }
    ],
    
    render() {
        const dateSelect = document.getElementById('pricelist-date-select');
        let targetDate = dateSelect.value;
        if (!targetDate) {
            targetDate = getEffectiveDate();
            dateSelect.value = targetDate;
        }
        
        document.getElementById('pricelist-date-display').textContent = formatDate(targetDate);
        
        dateSelect.onchange = () => {
            this.render();
        };
        
        let rawData = DB.getData(targetDate);
        if (!rawData) {
            // Fallback: cari data terbaru yang tersedia
            const latest = DB.getLatestData();
            if (latest) {
                rawData = latest.data;
                document.getElementById('pricelist-date-display').textContent = formatDate(latest.date) + ' (terbaru)';
            } else {
                rawData = [];
            }
        }
        this.data = rawData.map(p => ({
            ...p,
            hargaOnline: PriceCalc.hargaOnline(p.distribusi),
            hargaOffline: PriceCalc.hargaOffline(p.distribusi)
        }));
        
        this.renderHeader();
        this.applyFiltersAndSort();
    },
    
    renderHeader() {
        const headerRow = document.getElementById('pricelist-header-row');
        const filterRow = document.getElementById('pricelist-filter-row');
        
        headerRow.innerHTML = '';
        filterRow.innerHTML = '';
        
        this.columns.forEach(col => {
            if (col.adminOnly && !Auth.isAdmin()) return;
            
            // Header cell
            const th = document.createElement('th');
            th.textContent = col.label;
            if (col.class) th.classList.add(col.class);
            th.style.cursor = 'pointer';
            
            if (this.sortColumn === col.key) {
                th.textContent += this.sortDirection === 'asc' ? ' ↑' : ' ↓';
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
            filterRow.appendChild(filterTh);
        });
    },
    
    applyFiltersAndSort() {
        this.filteredData = this.data.filter(item => {
            for (const key in this.filters) {
                const filterVal = this.filters[key].toLowerCase();
                if (!filterVal) continue;
                
                const itemVal = String(item[key] || '').toLowerCase();
                if (!itemVal.includes(filterVal)) return false;
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
            tbody.innerHTML = '';
            tableWrapper.style.display = 'none';
            emptyState.style.display = 'flex';
            return;
        }
        
        tableWrapper.style.display = 'block';
        emptyState.style.display = 'none';
        
        tbody.innerHTML = this.filteredData.map(item => {
            let rowHtml = '<tr>';
            this.columns.forEach(col => {
                if (col.adminOnly && !Auth.isAdmin()) return;
                
                let val = item[col.key];
                let displayVal = val;
                if (col.type === 'currency') displayVal = formatCurrency(val);
                else if (col.type === 'number') displayVal = formatNumber(val);
                
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
        
        const exportData = this.filteredData.map(item => {
            const row = {};
            this.columns.forEach(col => {
                if (col.adminOnly && !Auth.isAdmin()) return;
                row[col.label] = item[col.key];
            });
            return row;
        });
        
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "PriceList");
        
        const dateStr = document.getElementById('pricelist-date-select').value;
        XLSX.writeFile(wb, `Vicmic_PriceList_${dateStr}.xlsx`);
    }
};

// 11. REPORTS MODULE
const Reports = {
    render() {
        const dateStr = getEffectiveDate();
        document.getElementById('reports-date-label').textContent = formatDate(dateStr);
        
        const dataObj = DB.getData(dateStr);
        const prevDataObj = DB.getPreviousData(dateStr);
        
        const data = dataObj || [];
        const prevData = prevDataObj ? prevDataObj.data : [];
        
        this.renderNewItems(data, prevData);
        this.renderOutOfStock(data);
        
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
            <th>No.</th>
            <th>Deskripsi</th>
            <th>Distribusi</th>
            <th>Serpong</th>
            <th>Harco</th>
            <th>Total</th>
        `;
        
        if (newItems.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Tidak ada barang baru hari ini</td></tr>';
            return;
        }
        
        tbody.innerHTML = newItems.map((item, i) => `
            <tr>
                <td>${i+1}</td>
                <td>${item.deskripsi}</td>
                <td>${formatCurrency(item.distribusi)}</td>
                <td>${formatNumber(item.serpong)}</td>
                <td>${formatNumber(item.harco)}</td>
                <td>${formatNumber(item.total)}</td>
            </tr>
        `).join('');
    },
    
    renderOutOfStock(data) {
        const oosItems = data.filter(p => p.total === 0 || p.serpong === 0);
        
        const tbody = document.querySelector('#oos-table tbody');
        document.querySelector('#oos-table thead tr').innerHTML = `
            <th>No.</th>
            <th>Deskripsi</th>
            <th>Total</th>
            <th>Serpong</th>
            <th>Harco</th>
        `;
        
        if (oosItems.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Tidak ada barang kosong</td></tr>';
            return;
        }
        
        tbody.innerHTML = oosItems.map((item, i) => {
            let rowClass = item.total === 0 ? 'row-danger' : (item.serpong === 0 ? 'row-warning' : '');
            return `
            <tr class="${rowClass}">
                <td>${i+1}</td>
                <td>${item.deskripsi}</td>
                <td>${formatNumber(item.total)}</td>
                <td>${formatNumber(item.serpong)}</td>
                <td>${formatNumber(item.harco)}</td>
            </tr>
        `}).join('');
    }
};

// 12. USER MANAGEMENT MODULE
const UserManagement = {
    render() {
        this.renderTable();
        const form = document.getElementById('add-user-form');
        form.onsubmit = (e) => {
            e.preventDefault();
            const email = document.getElementById('input-user-email').value.trim();
            const role = document.getElementById('select-user-role').value;
            
            if (!email) return;
            
            if (DB.findUser(email)) {
                showToast('Email sudah terdaftar', 'error');
                return;
            }
            
            DB.addUser(email, role, Auth.currentUser.email);
            showToast('User berhasil ditambahkan', 'success');
            document.getElementById('input-user-email').value = '';
            this.renderTable();
        };
    },
    
    renderTable() {
        const tbody = document.getElementById('users-table-body');
        const users = DB.getUsers();
        
        tbody.innerHTML = users.map(u => `
            <tr>
                <td>${u.email} ${u.isSuperAdmin ? '<span class="badge badge-admin">SUPER ADMIN</span>' : ''}</td>
                <td><span class="user-role-badge badge-${u.role}">${u.role.toUpperCase()}</span></td>
                <td>${u.addedBy || '-'}</td>
                <td>${formatDate(u.addedAt)}</td>
                <td>
                    ${!u.isSuperAdmin ? `<button class="btn btn-sm btn-danger btn-delete-user" data-email="${u.email}">Hapus</button>` : ''}
                </td>
            </tr>
        `).join('');
        
        document.querySelectorAll('.btn-delete-user').forEach(btn => {
            btn.onclick = () => {
                const email = btn.dataset.email;
                if (confirm(`Hapus user ${email}?`)) {
                    DB.removeUser(email);
                    showToast('User dihapus', 'success');
                    this.renderTable();
                }
            };
        });
    }
};

// 13. UPLOAD MODULE
const Upload = {
    selectedFile: null,
    
    init() {
        const dropzone = document.getElementById('upload-dropzone');
        const fileInput = document.getElementById('file-input');
        const btnUpload = document.getElementById('btn-upload');
        const dateInput = document.getElementById('upload-date');
        
        dateInput.value = getEffectiveDate();
        
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
            DB.saveData(dateStr, products);
            
            showToast(`Berhasil menyimpan ${products.length} produk`, 'success');
            document.getElementById('upload-status').innerHTML = '';
            this.selectedFile = null;
            document.getElementById('file-input').value = '';
            
            Dashboard.render();
            
        } catch (err) {
            showToast(err, 'error');
            document.getElementById('upload-status').innerHTML = `<span style="color:var(--danger-color)">${err}</span>`;
        } finally {
            document.getElementById('btn-upload').disabled = !this.selectedFile;
        }
    }
};

// 14. APP INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
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
    
    // Export
    document.getElementById('btn-export').addEventListener('click', () => PriceList.exportToExcel());
    
    // Upload init
    Upload.init();
    
    // Initialize Auth
    Auth.init();
});
