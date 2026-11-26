import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { getAppMode, getLocations, getMenu } from './webApi';

/** The menu refreshes this often, and whenever the tab regains focus (BUILD_PLAN §5.2). */
export const MENU_REFRESH_MS = 30_000;

/** The ERP's data mode ('demo' or 'pilot'), read from the database, never from a build flag. */
export function useAppMode() {
  return useQuery({ queryKey: ['web', 'mode'], queryFn: getAppMode, staleTime: Infinity, enabled: !!supabase });
}

export function useLocations() {
  return useQuery({ queryKey: ['web', 'locations'], queryFn: getLocations, staleTime: 60_000 });
}

export function useMenu(locationId: string | null) {
  return useQuery({
    queryKey: ['web', 'menu', locationId],
    queryFn: () => getMenu(locationId!),
    enabled: locationId !== null,
    refetchInterval: MENU_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}
