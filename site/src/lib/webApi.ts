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
  /** Exact decimal text, e.g. "0.072500"; null when no rate is in force. */
  tax_rate: z.string().nullable(),
  items: z.array(menuItemSchema),
});

export const slotsSchema = z.object({
  location_id: z.string(),
  ordering_open: z.boolean(),
  status_reason: z.string().nullable(),
  slots: z.array(z.object({ pickup_at: z.string(), available: z.boolean() })),
});

const orderLineSchema = z.object({
  item_id: z.string(),
  name: z.string(),
  quantity: z.number().int(),
  unit_price_cents: z.number().int(),
  gross_cents: z.number().int(),
  discount_cents: z.number().int(),
  net_cents: z.number().int(),
  tax_cents: z.number().int(),
});

export const webOrderSchema = z.object({
  ok: z.literal(true),
  order_number: z.string(),
  pickup_code: z.string(),
  web_token: z.string().uuid(),
  status: z.enum(['accepted', 'preparing', 'ready', 'completed', 'cancelled']),
  requested_pickup_at: z.string(),
  location: z.object({ location_id: z.string(), name: z.string() }),
  pickup_name: z.string().nullable(),
  note: z.string().nullable(),
  lines: z.array(orderLineSchema),
  gross_cents: z.number().int(),
  discount_cents: z.number().int(),
  net_cents: z.number().int(),
  tax_rate: z.string(),
  tax_cents: z.number().int(),
  total_cents: z.number().int(),
  tender_mode: z.enum(['SIMULATED', 'MANUAL_EXTERNAL']),
  paid_cents: z.number().int(),
  balance_due_cents: z.number().int(),
  payment: z.enum(['simulated', 'pay_at_pickup']),
  accepted_at: z.string(),
  replayed: z.boolean().optional(),
});

const requestResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not_found') }),
  z.object({ status: z.literal('in_progress'), rpc_name: z.string(), result: z.null() }),
  z.object({ status: z.literal('committed'), rpc_name: z.string(), result: z.unknown() }).passthrough(),
]);

const appModeSchema = z.object({ data_mode: z.enum(['pilot', 'demo']) }).passthrough();

export type WebLocation = z.infer<typeof locationSchema>;
export type MenuItem = z.infer<typeof menuItemSchema>;
export type Menu = z.infer<typeof menuSchema>;

export type WebSlots = z.infer<typeof slotsSchema>;
export type WebOrder = z.infer<typeof webOrderSchema>;
export type RequestResult = z.infer<typeof requestResultSchema>;

/**
 * A stable error code: the ERP's own code, or not_configured / network /
 * unexpected_response. `uncertain` means the server may or may not have
 * committed (no definite answer arrived), so a write must be checked first.
 */
export class WebApiError extends Error {
  constructor(
    readonly code: string,
    readonly uncertain = false,
  ) {
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
    throw new WebApiError('network', true);
  }
  if (result.error) {
    // P0001 is the ERP's own refusal: nothing was committed. Anything else
    // (network, gateway, timeout) leaves the outcome unknown.
    if (result.error.code === 'P0001') throw new WebApiError(result.error.message);
    throw new WebApiError('network', true);
  }
  const parsed = schema.safeParse(result.data);
  // A reply we cannot read may still be a committed write, so it is uncertain too.
  if (!parsed.success) throw new WebApiError('unexpected_response', true);
  return parsed.data;
}

export const getLocations = () => call('web_get_locations', {}, z.array(locationSchema));
export const getMenu = (locationId: string) => call('web_get_menu', { p_location_id: locationId }, menuSchema);
export const getAppMode = () => call('get_public_app_mode', {}, appModeSchema);
export const getSlots = (locationId: string, itemIds: string[]) =>
  call(
    'web_get_pickup_slots',
    { p_location_id: locationId, p_lines: itemIds.map((item_id) => ({ item_id, quantity: 1 })) },
    slotsSchema,
  );
export const getOrder = (token: string) => call('web_get_order', { p_web_token: token }, webOrderSchema);
export const getRequestResult = (requestKey: string) =>
  call('web_get_request_result', { p_request_key: requestKey }, requestResultSchema);

export interface PlaceOrderInput {
  requestKey: string;
  locationId: string;
  lines: Array<{ item_id: string; quantity: number }>;
  contact: { name: string; phone: string; email: string };
  pickupAt: string;
  note: string | null;
}

export const placeOrder = (o: PlaceOrderInput) =>
  call(
    'web_place_order',
    {
      p_request_key: o.requestKey,
      p_location_id: o.locationId,
      p_lines: o.lines,
      p_contact: o.contact,
      p_pickup_at: o.pickupAt,
      p_note: o.note,
    },
    webOrderSchema,
  );
