// Reset the LOCAL Supabase database only (re-applies all migrations; pilot mode).
// `supabase db reset` without --linked/--db-url always targets the local stack.
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['supabase', 'db', 'reset', '--local'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
