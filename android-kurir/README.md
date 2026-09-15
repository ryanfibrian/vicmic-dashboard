# Vicmic Kurir (Android)

App pendamping untuk kurir: mulai/selesaikan perjalanan dan kirim posisi GPS ke admin
**di latar belakang** (layar terkunci / app di-minimize tetap jalan), pakai backend
Supabase yang sama dengan dashboard web. Ini pelengkap fitur Log Kurir di web — dipakai
kalau tracking berbasis browser (yang cuma jalan selagi tab terbuka) tidak cukup.

Dibangun pakai [Capacitor](https://capacitorjs.com) (bungkus halaman web sederhana jadi
app Android asli) + [`@capacitor-community/background-geolocation`](https://github.com/capacitor-community/background-geolocation)
(MIT, gratis, open-source) untuk GPS latar belakang lewat foreground service Android —
bukan sekadar Geolocation API browser yang berhenti begitu tab tidak aktif.

**100% gratis** — tidak ada API key berbayar, tidak ada akun Google Play Developer yang
wajib (app di-sideload, bukan dipublikasikan ke Play Store).

---

## 1. Setup sekali di awal (wajib sebelum app bisa login)

App ini login pakai flow OAuth redirect Supabase (`signInWithOAuth`), beda dari web yang
pakai `signInWithIdToken()`. Ini butuh dua config tambahan — lihat
[`../supabase/SETUP.md`](../supabase/SETUP.md) bagian 1, poin 2 dan 5:

1. **Google Cloud Console** → OAuth client "Supabase Auth Client" → *Authorized redirect
   URIs* → tambahkan `https://dpnndfgeyuqblpbfzlii.supabase.co/auth/v1/callback`.
2. **Supabase → Authentication → URL Configuration → Redirect URLs** → tambahkan
   `vicmickurir://auth-callback`.

Tanpa dua ini, tombol "Masuk dengan Google" di app akan gagal atau macet setelah kembali
dari layar login Google.

Kolom GPS (`last_lat`, `last_lng`, `last_ping_at`) di `courier_logs` juga harus sudah ada
— itu migration `006_courier_position.sql`, sama seperti yang dipakai fitur peta di web.

Tabel alamat favorit juga perlu dibuat — jalankan `migrations/007_courier_favorites.sql`
sebelum memakai tombol ⭐ di app.

Untuk fitur "Lihat Rute" di dashboard admin (jejak GPS per perjalanan), jalankan juga
`migrations/008_courier_track.sql` — tanpa ini, posisi tetap terkirim untuk peta live,
tapi jejaknya tidak tersimpan untuk dilihat lagi setelah perjalanan selesai.

## 2. Build APK (tanpa Android Studio — pakai GitHub Actions, gratis)

1. Push perubahan apa pun di folder `android-kurir/` (atau trigger manual: tab **Actions**
   di GitHub → workflow **"Build Vicmic Kurir APK"** → **Run workflow**).
2. Tunggu selesai (~beberapa menit), lalu buka run tersebut → bagian **Artifacts** →
   download `vicmic-kurir-debug-apk` (isinya `app-debug.apk`).
3. File ini yang di-install ke HP kurir.

Setiap build pakai debug-keystore yang sama (di-cache oleh workflow), jadi APK hasil
build baru bisa **menimpa** (update) instalasi lama tanpa perlu uninstall dulu — asalkan
tetap lewat workflow yang sama.

### Build lokal (opsional, kalau punya Android Studio)

```bash
cd android-kurir
npm install
npx cap sync android
npx cap open android   # lalu Build > Build Bundle(s)/APK(s) > Build APK(s) di Android Studio
```

## 3. Install ke HP kurir (sideload)

APK ini tidak lewat Play Store, jadi:

1. Kirim file `app-debug.apk` ke HP kurir (WhatsApp, Google Drive, kabel, dll).
2. Buka file-nya di HP → Android akan minta izin **"Install dari sumber tidak dikenal"**
   untuk app yang dipakai membuka file itu (mis. WhatsApp/Chrome) → izinkan.
3. Lanjutkan instalasi seperti biasa.
4. Buka app **"Vicmic Kurir"**, login pakai akun Google yang sama seperti login ke
   dashboard web (harus sudah terdaftar sebagai kurir di `allowed_users`).

### Izin yang akan diminta, dan kenapa

- **Lokasi ("Saat menggunakan app" lalu "Selalu izinkan")** — wajib untuk GPS jalan waktu
  layar terkunci. Kalau kurir cuma pilih "saat menggunakan app", tracking berhenti begitu
  app di-minimize (sama seperti versi browser).
- **Notifikasi** — Android **mewajibkan** notifikasi permanen ("Vicmic Kurir: mengirim
  posisi…") selama tracking aktif, sebagai tanda GPS sedang dipakai di latar belakang.
  Ini bukan bug dan tidak bisa disembunyikan — aturan resmi Android untuk foreground
  service lokasi.

## 4. Update app di kemudian hari

Tidak ada auto-update seperti web (PWA). Alurnya: ubah kode → push → tunggu Actions
selesai → download APK baru → kirim ulang ke HP kurir → install menimpa yang lama.

## 5. Batasan yang perlu diketahui

- Butuh **Google Play Services** terpasang di HP (hampir semua HP Android non-Huawei
  terbaru sudah punya ini bawaan).
- Kalau kurir mencabut izin lokasi lewat Pengaturan HP, tracking berhenti sampai izin
  diberikan lagi dari dalam app.
- Baterai: foreground service + GPS aktif memang memakai daya lebih dari app biasa —
  ini trade-off yang tidak terhindarkan untuk tracking latar belakang yang akurat.
- App ini sengaja dibuat minimal (cuma mulai/selesai perjalanan) — fitur lain (price
  list, rekap, dsb.) tetap di dashboard web, bukan dobel-dikerjakan di sini.

## 6. Pilih lokasi di peta + hitung jarak otomatis

Field **Lokasi Asal**/**Lokasi Tujuan** masing-masing punya dua tombol:

- **🗺️ Pilih di peta** — buka peta ala Gojek: geser peta untuk pilih titik (pin selalu di
  tengah layar), atau ketik nama tempat di kotak pencarian. Alamatnya otomatis muncul dari
  titik yang dipilih (reverse geocoding).
- **⭐ Alamat favorit** — pilih dari daftar alamat yang pernah disimpan kurir ini sendiri,
  atau simpan lokasi yang baru dipilih supaya tidak perlu cari/ketik ulang lain kali.

Begitu **Asal** dan **Tujuan** sudah sama-sama punya titik (dari peta atau favorit), jarak
tempuh (KM) dihitung otomatis lewat rute jalan sungguhan (bukan garis lurus) dan mengisi
field Jarak — tetap bisa diedit manual kalau perlu.

Tiga layanan gratis/open-source di balik ini (tanpa API key, tanpa billing):
**MapLibre GL + OpenFreeMap** (peta vector, gaya Grab/Gojek — sebelumnya Leaflet + tile
raster OSM/Esri, diganti karena hasilnya kurang modern), **Photon** (cari tempat & reverse
geocoding), **OSRM** (hitung jarak rute — cek sendiri: server publiknya tidak punya profil
motor terpisah, `driving`/`cycling`/`foot` semua kasih hasil identik, jadi KM yang tampil
itu estimasi rute mobil, bukan motor). Ini server demo publik, bukan layanan berbayar bergaransi
uptime — kalau lagi lambat/gangguan, semua bagian ini gagal dengan sopan (pesan "isi
manual"), tidak memblokir kurir untuk tetap mulai jalan dengan isi manual seperti biasa.

## Struktur

```
android-kurir/
  www/                  # halaman app: index.html, app.js, config.js, style.css
  android/              # project native Android (Capacitor) — jangan edit file yang
                         # ditandai "DO NOT EDIT", itu di-generate ulang oleh `cap sync`
  capacitor.config.json  # appId, nama app, konfigurasi Android
  package.json
```

Perubahan tampilan/logika app ada di `www/app.js` (JS polos, tanpa bundler — sama
filosofinya dengan dashboard web). Setelah edit `www/`, jalankan `npx cap sync android`
supaya perubahan ikut ter-copy ke project Android sebelum build.
