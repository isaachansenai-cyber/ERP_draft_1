// AC30 secret scan: repository files (tracked + new, not ignored) and the
// production bundle (dist/). Fails on service-role/secret keys, inline database
// passwords, credential files, real-data folders and password literals.
//
// Usage: node scripts/security/scan-secrets.mjs [--require-dist]
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// The scanner and its own unit test (which assembles secret-shaped strings at
// runtime to prove detection) are the only files exempt from content scanning.
const EXEMPT = new Set(['scripts/security/scan-secrets.mjs', 'tests/unit/scan-secrets.test.ts']);

const FORBIDDEN_PATHS = [
  {
    re: /(^|\/)\.env(\..+)?$/,
    why: 'environment file (only .env.example may be committed)',
    allow: /(^|\/)\.env\.example$/,
  },
  { re: /(^|\/)DEMO_CREDENTIALS[^/]*$/i, why: 'demo credentials file' },
  { re: /^(exports|pilot-data)\//, why: 'real-data export folder' },
  { re: /\.(dump|backup|pgdump)$/i, why: 'database dump' },
  { re: /(^|\/)supabase\/\.temp\//, why: 'Supabase CLI temp state' },
];

const PRIVILEGED_ROLES = new Set(['service_role', 'supabase_admin', 'postgres']);
const PLACEHOLDER = /^(<.*|\$\{[^}]+\}|\.{3}|x+|\*+|password|changeme)$/i;

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1];
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/** Return findings for one text blob. `bundle` enables stricter production-bundle rules. */
export function findSecrets(text, { bundle = false } = {}) {
  const findings = [];
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g)) {
    const payload = decodeJwtPayload(m[0]);
    if (payload && PRIVILEGED_ROLES.has(payload.role)) findings.push(`JWT with privileged role "${payload.role}"`);
  }
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(text)) findings.push('Supabase secret key (sb_secret_…)');
  for (const m of text.matchAll(/postgres(?:ql)?:\/\/([^:\s/@'"`]+):([^@\s'"`]+)@/g)) {
    if (!PLACEHOLDER.test(m[2])) findings.push('database connection string with an inline password');
  }
  for (const m of text.matchAll(/SUPABASE_(?:SERVICE_ROLE|SECRET)_KEY[ \t]*[=:][ \t]*["']?([^\s"'`\]]+)/g)) {
    if (
      !PLACEHOLDER.test(m[1]) &&
      !m[1].startsWith('process.env') &&
      !m[1].startsWith('stack.') &&
      !m[1].startsWith('${{') &&
      !/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(m[1]) // a shell variable reference, not a value
    ) {
      findings.push('service-role key assignment');
    }
  }
  for (const m of text.matchAll(/\b(?:password|passwd|pin)[ \t]*[:=][ \t]*["'`]([^"'`\s]{8,})["'`]/gi)) {
    if (!PLACEHOLDER.test(m[1])) findings.push('password literal');
  }
  if (bundle) {
    if (/service_role/.test(text)) findings.push('"service_role" appears in the production bundle');
    if (/SUPABASE_(?:SERVICE_ROLE|SECRET)_KEY|DATABASE_URL/.test(text))
      findings.push('server-only variable name in the production bundle');
  }
  return findings;
}

function repoFiles() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return out
    .split('\0')
    .filter(Boolean)
    .filter((f) => existsSync(join(ROOT, f)));
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function scan({ requireDist = false } = {}) {
  const problems = [];
  for (const file of repoFiles()) {
    for (const rule of FORBIDDEN_PATHS) {
      if (rule.re.test(file) && !(rule.allow && rule.allow.test(file))) problems.push(`${file}: ${rule.why}`);
    }
    if (EXEMPT.has(file) || statSync(join(ROOT, file)).size > 5_000_000) continue;
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const f of findSecrets(text)) problems.push(`${file}: ${f}`);
  }
  const dist = join(ROOT, 'dist');
  if (existsSync(dist)) {
    for (const p of walk(dist)) {
      for (const f of findSecrets(readFileSync(p, 'utf8'), { bundle: true }))
        problems.push(`${relative(ROOT, p)}: ${f}`);
    }
  } else if (requireDist) {
    problems.push('dist/ not found: run npm run build first');
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const problems = scan({ requireDist: process.argv.includes('--require-dist') });
  if (problems.length) {
    console.error(`Secret scan FAILED (${problems.length}):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(
    `Secret scan passed: repository files${existsSync(join(ROOT, 'dist')) ? ' and dist/' : ''} contain no secrets.`,
  );
}
