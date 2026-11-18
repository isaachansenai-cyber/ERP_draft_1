import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { callRpc, SESSION_EXPIRED_EVENT } from '../lib/rpc';
import { supabase } from '../lib/supabase';

const SESSION_ENDED_KEY = 'session-ended';

/** Remember (for the sign-in page) that the session ended without the user signing out. */
function markSessionEnded(): void {
  try {
    window.sessionStorage.setItem(SESSION_ENDED_KEY, '1');
  } catch {
    /* per-tab convenience only */
  }
}

/** Whether the sign-in page should explain that the session ended (cleared on the next sign-in). */
export function sessionEndedNoticePending(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_ENDED_KEY) === '1';
  } catch {
    return false;
  }
}

function clearSessionEnded(): void {
  try {
    window.sessionStorage.removeItem(SESSION_ENDED_KEY);
  } catch {
    /* ignore */
  }
}

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
  const signingOut = useRef(false);
  const hadSession = useRef(false);
  const checkingExpiry = useRef(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      hadSession.current = Boolean(data.session);
      setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      // A sign-out the user did not ask for (refresh token rejected or revoked):
      // tell them on the sign-in page instead of leaving broken screens behind.
      if (event === 'SIGNED_OUT' && hadSession.current && !signingOut.current) markSessionEnded();
      if (event === 'SIGNED_IN') clearSessionEnded();
      hadSession.current = Boolean(next);
      setSession(next);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  // A server call reported the session as invalid: try one refresh; if that
  // fails, end the session on this device so the user is sent to sign in.
  useEffect(() => {
    async function onExpired() {
      if (checkingExpiry.current || !hadSession.current) return;
      checkingExpiry.current = true;
      try {
        const { data, error } = await supabase.auth.refreshSession();
        if (error || !data.session) {
          markSessionEnded();
          signingOut.current = true;
          await supabase.auth.signOut({ scope: 'local' });
          signingOut.current = false;
          queryClient.clear();
        } else {
          await queryClient.invalidateQueries();
        }
      } finally {
        checkingExpiry.current = false;
      }
    }
    const handler = () => void onExpired();
    window.addEventListener(SESSION_EXPIRED_EVENT, handler);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
  }, [queryClient]);

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

  // Sign out of THIS device only. The default ('global') would also end every
  // other device's session for the same account (shared tablets, demo logins).
  const signOut = useCallback(async () => {
    signingOut.current = true;
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } finally {
      signingOut.current = false;
    }
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
