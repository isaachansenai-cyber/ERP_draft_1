import { useQuery } from '@tanstack/react-query';
import { callRpc, RpcError } from './rpc';

/**
 * The database migration this build of the app was written against (ADR 0036).
 * Bump it together with every new migration's get_schema_version().
 */
export const EXPECTED_SCHEMA_VERSION = 26;

export type SchemaStatus =
  | { state: 'ok'; database: number }
  | { state: 'database_behind'; database: number | null }
  | { state: 'app_behind'; database: number };

export function compareSchema(database: number | null): SchemaStatus {
  if (database === null || database < EXPECTED_SCHEMA_VERSION) return { state: 'database_behind', database };
  if (database > EXPECTED_SCHEMA_VERSION) return { state: 'app_behind', database };
  return { state: 'ok', database };
}

/** Asks the server once per page load. A database from before migration 0024 has no such function. */
export function useSchemaStatus() {
  return useQuery({
    queryKey: ['schema-version'],
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<SchemaStatus> => {
      try {
        return compareSchema(await callRpc<number>('get_schema_version', {}));
      } catch (e) {
        if (e instanceof RpcError && e.code === 'schema_out_of_date') return compareSchema(null);
        throw e;
      }
    },
  });
}
