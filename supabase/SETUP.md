# Setup Supabase — Vicmic Dashboard

Panduan menerapkan perubahan backend: **login Google yang benar (Supabase Auth)** + **Row
Level Security (RLS)** di semua tabel.

> **Kenapa perlu:** saat ini seluruh isi database bisa dibaca siapa saja yang punya anon key
> (anon key ada di dalam `js/config.js` yang publik). Termasuk harga modal (`price_data.distribusi`)
> dan daftar email + role user. RLS menutup ini. **Anon key tidak perlu diganti** — memang
> dirancang untuk publik; yang salah adalah tidak adanya RLS.

Semua langkah dikerjakan di **dashboard Supabase project Vicmic** (`dpnndfgeyuqblpbfzlii`).
Urutan penting.

---

## 1. Login Google di Supabase Auth

Frontend baru memakai `supabase.auth.signInWithIdToken()` supaya Supabase menerbitkan JWT
asli (berisi email terverifikasi). Tanpa ini, RLS tidak punya email untuk dicek.

**Status per September 2026:** provider Google di project `dpnndfgeyuqblpbfzlii` **sudah
aktif** dengan Client ID
`656289786823-iu0ffgvhl95giho0v3ei5fdbpvtntbec.apps.googleusercontent.com` dan secret sudah
terisi. `js/config.js` juga sudah memakai Client ID ini. Jadi yang tersisa hanya satu hal:

1. **Google Cloud Console → APIs & Services → Credentials → OAuth client
   "Supabase Auth Client"** (`656289786823-...`) → **Authorized JavaScript origins**,
   tambahkan (jangan hapus yang sudah ada):
   - `https://vicmic-dashboard.vercel.app`
   - `http://localhost:8000` (opsional, untuk tes lokal)
   Lalu **Save**. Perubahan origin bisa butuh 5 menit–beberapa jam untuk aktif.
2. *(Opsional, biar rapi)* **Authorized redirect URIs** tambahkan
   `https://dpnndfgeyuqblpbfzlii.supabase.co/auth/v1/callback`.
3. *(Opsional)* Supabase **Authentication → URL Configuration**: **Site URL** =
   `https://vicmic-dashboard.vercel.app`.
4. Kalau nanti login gagal dengan error soal **nonce**, buka Supabase → Auth → Providers →
   Google, nyalakan **Skip nonce checks**, Save.

> Entri origin lama `https://tbsgctmcbaxgkttlriml.supabase.co` (project Supabase lama yang
> tidak terpakai) boleh dibiarkan — tidak mengganggu.
> Tidak perlu mengubah "Confirm email" — login Google tidak butuh itu.

---

## 2. Jalankan migration SQL (berurutan)

Buka **SQL Editor**, jalankan isi file berikut satu per satu, sesuai urutan:

| Urut | File | Isi |
|------|------|-----|
| 1 | `migrations/001_helpers.sql` | Fungsi bantu `is_admin()`, `is_allowed_user()`, `jwt_email()`, `current_user_role()` |
| 2 | `migrations/002_rls.sql` | Aktifkan RLS + policy di `allowed_users`, `price_data`, `app_settings`, `courier_logs`; `get_distinct_dates()` jadi `security invoker` |
| 3 | `migrations/003_data_uploads.sql` | Tabel `data_uploads` (ganti metadata nama file yang dulu di localStorage) |
| 4 | `migrations/004_settings_seed.sql` | Seed `courier_rate_per_km = 300` |
| 5 | `migrations/005_retention_cron.sql` | *(opsional)* pg_cron untuk hapus data lama otomatis |

Kalau migration 5 dijalankan, aktifkan dulu extension **pg_cron** di
**Database → Extensions**.

---

## 3. Verifikasi

### a. Anon key sekarang terkunci

Dari terminal mana pun (ganti `ANON` dengan anon key di `js/config.js`):

```bash
curl -s "https://dpnndfgeyuqblpbfzlii.supabase.co/rest/v1/price_data?select=*&limit=1" \
  -H "apikey: ANON" -H "Authorization: Bearer ANON"
```

- **Sebelum:** balikin baris data.
- **Sesudah:** `[]` (kosong). Begitu juga `allowed_users` dan `courier_logs`.

### b. Login Google jalan

1. Buka `https://vicmic-dashboard.vercel.app` (atau lokal), login dengan akun yang ada di
   `allowed_users`.
2. Di dashboard Supabase **Authentication → Users**, muncul user baru dengan email tsb.
3. Aplikasi masuk sesuai role (admin → Dashboard, sales → Master Price List).
4. Akun Google yang **tidak** ada di `allowed_users` → ditolak dengan pesan "belum terdaftar".

### c. Spot-check RLS per role

| Aksi | admin | sales / sales_kurir |
|------|-------|---------------------|
| Baca `price_data` | ✅ | ✅ |
| Upload / hapus `price_data` | ✅ | ❌ (ditolak policy) |
| Tambah/edit/hapus user | ✅ | ❌ |
| Ubah rumus harga | ✅ | ❌ |
| Lihat log kurir orang lain | ✅ | ❌ (hanya miliknya) |
| Buat log kurir atas nama sendiri | ✅ | ✅ |

---

## 4. Rollback (kalau ada yang salah)

RLS bisa dimatikan sementara per tabel:

```sql
alter table public.allowed_users  disable row level security;
alter table public.price_data     disable row level security;
alter table public.app_settings   disable row level security;
alter table public.courier_logs   disable row level security;
```

Fungsi `get_distinct_dates()` versi lama (kalau perlu balik ke perilaku lama):

```sql
create or replace function public.get_distinct_dates()
returns table (date date) language sql stable security definer
set search_path = public
as $$ select distinct pd.date from public.price_data pd order by pd.date desc $$;
```

Frontend lama (branch `main` sebelum redesign) tetap jalan **hanya jika RLS dimatikan**,
karena dia belum pakai Supabase Auth. Jangan matikan RLS di produksi setelah frontend baru
live.

---

## Catatan

- **Anon key & Google Client ID di `js/config.js` aman untuk publik.** Yang rahasia
  (Google *client secret*, service_role key) tidak pernah masuk ke frontend.
- Kalau nanti mau menyembunyikan kolom `distribusi` dari role `sales` di level database
  (sekarang hanya disembunyikan di UI), buat `view price_data_sales` tanpa kolom itu +
  policy khusus, lalu frontend query view tsb untuk non-admin. Belum dikerjakan di sini.
