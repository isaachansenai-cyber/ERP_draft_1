import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

export interface ReasonCode {
  code: string;
  description: string;
  applies_to: string[];
  requires_note: boolean;
}

/** Active reason codes for one use (waste, refund, return, count, transfer, cancellation). Server validates again. */
export function useReasonCodes(use: string) {
  return useQuery({
    queryKey: ['reason-codes'],
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reason_codes')
        .select('code, description, applies_to, requires_note')
        .eq('active', true)
        .order('code');
      if (error) throw error;
      return data as ReasonCode[];
    },
    select: (rows) => rows.filter((r) => r.applies_to.includes(use)),
  });
}

export interface LocationRow {
  location_id: string;
  name: string;
  short_code: string;
}

export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('locations').select('location_id, name, short_code').order('name');
      if (error) throw error;
      return data as LocationRow[];
    },
  });
}
