import { PostgrestClient } from '@supabase/postgrest-js';

// Visitors never sign in (ADR 0042): the site holds only the public URL and the
// anon key, which can call the web_* functions and nothing else. It needs no
// auth, realtime or storage, so it uses the small PostgREST client on its own
// instead of the full supabase-js bundle (ADR 0045).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Null when the build has no backend configured; pages then show content only. */
export const supabase: PostgrestClient | null =
  url && anonKey
    ? new PostgrestClient(`${url.replace(/\/$/, '')}/rest/v1`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      })
    : null;
