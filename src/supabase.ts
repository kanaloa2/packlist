import { createClient } from '@supabase/supabase-js';

// Public project URL and publishable key. These are meant to ship in the browser:
// what each signed-in user can read or write is enforced by row level security.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://hpyjxwmfxjopbvojagqe.supabase.co';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_KdcUeJFeSRmSzNPe7pijWQ_bt3z9eGP';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    // PKCE returns ?code=… in the query string, which doesn't collide with our #/hash routes.
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/** Where confirmation and password-reset emails should send people back to. */
export function appUrl(): string {
  return window.location.origin + import.meta.env.BASE_URL;
}
