// @vitest-environment node
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without type declarations
import { findSecrets } from '../../scripts/security/scan-secrets.mjs';

// Fake tokens are assembled at runtime so no secret-shaped literal exists in the repository.
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role: string) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'test', role })}.${'s'.repeat(20)}`;

describe('AC30 secret scanner', () => {
  it('flags service-role JWTs but not the public anon key', () => {
    expect(findSecrets(`key=${jwt('service_role')}`)).toContain('JWT with privileged role "service_role"');
    expect(findSecrets(`key=${jwt('anon')}`)).toEqual([]);
  });

  it('flags secret keys, inline database passwords and password literals', () => {
    expect(findSecrets(['sb', 'secret', 'A1b2C3d4E5f6G7'].join('_'))).toHaveLength(1);
    expect(findSecrets(`postgresql://postgres:${'hunter2'}@db.host/postgres`)).toHaveLength(1);
    expect(findSecrets('postgresql://postgres:<password>@127.0.0.1:54322/postgres')).toEqual([]);
    expect(findSecrets(`password = "${'Sup3rS3cret!'}"`)).toHaveLength(1);
    expect(findSecrets(`SUPABASE_SERVICE_ROLE_KEY=${'abc123def456'}`)).toHaveLength(1);
    expect(findSecrets('SUPABASE_SERVICE_ROLE_KEY=\nNEXT=1')).toEqual([]);
  });

  it('is stricter for the production bundle', () => {
    expect(findSecrets('role:"service_role"', { bundle: true })).toHaveLength(1);
    expect(findSecrets('import.meta.env.DATABASE_URL', { bundle: true })).toHaveLength(1);
  });
});
