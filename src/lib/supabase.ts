import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// The only configuration the browser receives: project URL + publishable/anon key.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configError =
  !url || !anonKey ? 'The app is not configured: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.' : null;

export const supabase = createClient<Database>(url ?? 'http://invalid.localhost', anonKey ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
