# Vicmic Indonesia Dashboard

PWA untuk manajemen price list & stok harian Vicmic Indonesia: dashboard analisis,
master price list, laporan harian, manajemen user, pengaturan rumus harga, dan log
perjalanan kurir. Frontend statis (tanpa build step), backend Supabase, deploy di Vercel.

Live: https://vicmic-dashboard.vercel.app

## Struktur

```
index.html            # app shell + semua markup halaman
style.css             # satu stylesheet, tema gelap/terang lewat <html data-theme>
sw.js                 # service worker (network-first, offline fallback)
manifest.json         # PWA manifest
js/
  main.js             # entry point, wiring app shell
  config.js           # URL + anon key Supabase, konstanta
  utils.js            # helper format/parsing murni
  ui.js               # toast, modal, confirmModal, loading
  db.js               # semua query Supabase
  auth.js             # login Google via Supabase Auth + gating role
  router.js           # routing hash + guard per role
  excel.js            # parser workbook upload
  priceCalc.js        # evaluasi rumus harga + halaman Settings
  theme.js            # toggle tema gelap/terang
  pages/*.js          # satu modul per halaman
supabase/
  migrations/*.sql    # RLS + auth + skema (diterapkan manual, lihat SETUP.md)
  SETUP.md            # langkah setup Supabase
```

## Menjalankan lokal

ES modules butuh HTTP (bukan `file://`). Dari root repo:

```bash
npx serve .
# atau
python -m http.server 8000
```

Buka `http://localhost:8000`. Di localhost tersedia **Mode Demo** (email-only) untuk
kerja UI tanpa Google — hanya berfungsi bila email ada di `allowed_users` dan RLS
tidak menghalangi (mis. project dev dengan RLS off).

Setelah mengubah `js/**`, `style.css`, atau `index.html`, naikkan angka `?v=` di
`index.html` dan `CACHE_NAME` di `sw.js` supaya klien mengambil versi baru.

## Backend (Supabase)

Login memakai **Supabase Auth (provider Google)**. RLS aktif di semua tabel; hanya
email yang terdaftar di `allowed_users` yang bisa membaca data, dan hanya `admin`
yang bisa menulis. Anon key di `js/config.js` memang publik — yang mengamankan data
adalah RLS.

Langkah penerapan schema/policy ada di [`supabase/SETUP.md`](supabase/SETUP.md).
Jalankan file `supabase/migrations/00{1..5}_*.sql` berurutan di SQL Editor.

## Deploy (Vercel)

Vercel auto-deploy dari branch `main` (project statis, tanpa konfigurasi build).
Merge branch fitur ke `main` → deploy jalan otomatis. Preview deployment dibuat
untuk setiap branch/PR.
