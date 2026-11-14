import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { callRpc } from '../lib/rpc';
import { supabase } from '../lib/supabase';

export type Role = 'owner' | 'manager' | 'employee';

export interface LocationRole {
  location_id: string;
  location_name: string;
  short_code: string;
  role: Role;
}

export interface MyContext {
  signed_in: boolean;
  employee: { employee_id: string; display_name: string } | null;
  is_owner: boolean;
  roles: LocationRole[];
  can_set_manager_pin?: boolean;
  has_manager_pin?: boolean;
  data_mode: 'pilot' | 'demo';
  posting_enabled: boolean;
  company_name: string;
  business_date: string;
}

interface AuthValue {
  /** undefined while the stored session is being restored */
  session: Session | null | undefined;
  context: MyContext | undefined;
  contextLoading: boolean;
  contextError: Error | null;
  /** Locations come only from the server's memberships; the selection merely filters among them. */
  selectedLocation: LocationRole | null;
  selectLocation: (locationId: string) => void;
  refreshContext: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthValue | null>(null);
const LOCATION_KEY = 'selected-location';

function readStoredLocation(): string | null {
  try {
    return window.localStorage.getItem(LOCATION_KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [locationId, setLocationId] = useState<string | null>(readStoredLocation);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id ?? null;
  const contextQuery = useQuery({
    queryKey: ['my-context', userId],
    queryFn: () => callRpc<MyContext>('get_my_context', {}),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });

  const context = userId ? contextQuery.data : undefined;
  const roles = useMemo(() => context?.roles ?? [], [context]);
  const selectedLocation = roles.find((r) => r.location_id === locationId) ?? roles[0] ?? null;

  const selectLocation = useCallback((id: string) => {
    setLocationId(id);
    try {
      window.localStorage.setItem(LOCATION_KEY, id);
    } catch {
      /* per-viewer convenience only */
    }
  }, []);

  const refreshContext = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['my-context'] });
  }, [queryClient]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    queryClient.clear();
  }, [queryClient]);

  const value: AuthValue = {
    session,
    context,
    contextLoading: Boolean(userId) && contextQuery.isPending,
    contextError: contextQuery.error,
    selectedLocation,
    selectLocation,
    refreshContext,
    signOut,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthCtx);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
