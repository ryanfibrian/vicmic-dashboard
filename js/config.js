// ============================================================================
// config.js — environment, constants, and the shared Supabase client.
//
// SUPABASE_ANON_KEY and GOOGLE_CLIENT_ID are meant to be public. What protects
// the data is Row Level Security on the database (see supabase/SETUP.md), not
// hiding these strings.
// ============================================================================

export const SUPABASE_URL = 'https://dpnndfgeyuqblpbfzlii.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwbm5kZmdleXVxYmxwYmZ6bGlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0MzMwNzQsImV4cCI6MjEwMDAwOTA3NH0.2qCER7lIRBsz3_JMVhKK4L9HQe4R_NVjsiwGo4uwOXY';

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export const CONFIG = {
  // Must match the "Client IDs" list in Supabase → Auth → Providers → Google
  // for project dpnndfgeyuqblpbfzlii.
  GOOGLE_CLIENT_ID:
    '656289786823-iu0ffgvhl95giho0v3ei5fdbpvtntbec.apps.googleusercontent.com',

  // Fallback courier commission when app_settings.courier_rate_per_km is missing.
  DEFAULT_COURIER_RATE_PER_KM: 300,

  // Data retention windows (only used by the admin-triggered manual cleanup;
  // the routine cleanup is a pg_cron job — see migration 005).
  PRICE_DATA_RETENTION_DAYS: 60,
  COURIER_LOG_RETENTION_DAYS: 90,

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
    promo_sellout: ['promo sellout', 'promo', 'sellout', 'cashback'],
  },
  REQUIRED_COLUMNS: ['distribusi', 'serpong', 'harco', 'total', 'deskripsi'],
};

// True only on a developer machine — gates the email-only demo login.
export const IS_LOCALHOST =
  ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ||
  location.hostname.endsWith('.local');
