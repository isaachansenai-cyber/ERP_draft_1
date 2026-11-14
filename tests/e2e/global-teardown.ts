import { readFileSync } from 'node:fs';

export default async function globalTeardown() {
  const file = process.env.E2E_SERVER_PID_FILE;
  if (!file) return;
  const pid = Number(readFileSync(file, 'utf8'));
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    /* already stopped */
  }
}
