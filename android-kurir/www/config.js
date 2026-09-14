// ============================================================================
// config.js — same public Supabase anon key + project URL as the main
// dashboard (js/config.js). Safe to ship: Row Level Security is what
// protects the data, not hiding these strings. See supabase/SETUP.md.
// ============================================================================

window.VICMIC_CONFIG = {
  SUPABASE_URL: 'https://dpnndfgeyuqblpbfzlii.supabase.co',
  SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwbm5kZmdleXVxYmxwYmZ6bGlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0MzMwNzQsImV4cCI6MjEwMDAwOTA3NH0.2qCER7lIRBsz3_JMVhKK4L9HQe4R_NVjsiwGo4uwOXY',

  // Must be registered in Supabase → Authentication → URL Configuration →
  // Redirect URLs, and must match the intent-filter scheme in
  // android/app/src/main/AndroidManifest.xml. See ../SETUP.md.
  OAUTH_REDIRECT: 'vicmickurir://auth-callback',

  // Fallback commission rate; the real value in app_settings.courier_rate_per_km
  // (set from the dashboard's Pengaturan page) always wins when reachable.
  DEFAULT_COURIER_RATE_PER_KM: 300,
};
