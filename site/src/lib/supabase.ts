import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Visitors never sign in (ADR 0042): the site holds only the public URL and the
// anon key, which can call the web_* functions and nothing else.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Null when the build has no backend configured; pages then show content only. */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
    : null;
