import { z } from 'zod';
import { supabase } from './supabase';

// Typed contracts for the ERP's public web_* functions (BUILD_PLAN §2.1).
// Every response is checked here, so pages work with known shapes only.

const hoursSchema = z.object({ weekday: z.number().int().min(1).max(7), opens_at: z.string(), closes_at: z.string() });

export const locationSchema = z.object({
  location_id: z.string(),
  name: z.string(),
  ordering_open: z.boolean(),
  status_reason: z.string().nullable(),
  hours: z.array(hoursSchema),
});

export const menuItemSchema = z.object({
  item_id: z.string(),
  name: z.string(),
  item_type: z.enum(['finished_dish', 'retail']),
  country: z.string().nullable(),
  description: z.string(),
  image_path: z.string().nullable(),
  allergen_note: z.string().nullable(),
  price_cents: z.number().int().nonnegative().nullable(),
  prep_lead_days: z.number().int().nullable(),
  prep_minutes: z.number().int().nullable(),
  available: z.boolean(),
  max_orderable: z.number().int().nonnegative(),
});

export const menuSchema = z.object({
  location_id: z.string(),
  ordering_open: z.boolean(),
  status_reason: z.string().nullable(),
  max_per_line: z.number().int().nonnegative(),
  items: z.array(menuItemSchema),
});

export type WebLocation = z.infer<typeof locationSchema>;
export type MenuItem = z.infer<typeof menuItemSchema>;
export type Menu = z.infer<typeof menuSchema>;

/** A stable error code: the ERP's own code, or not_configured / network / unexpected_response. */
export class WebApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'WebApiError';
  }
}

async function call<T>(fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  if (!supabase) throw new WebApiError('not_configured');
  let result: Awaited<ReturnType<typeof supabase.rpc>>;
  try {
    result = await supabase.rpc(fn, args);
  } catch {
    throw new WebApiError('network');
  }
  if (result.error) throw new WebApiError(result.error.code === 'P0001' ? result.error.message : 'network');
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) throw new WebApiError('unexpected_response');
  return parsed.data;
}

export const getLocations = () => call('web_get_locations', {}, z.array(locationSchema));
export const getMenu = (locationId: string) => call('web_get_menu', { p_location_id: locationId }, menuSchema);
