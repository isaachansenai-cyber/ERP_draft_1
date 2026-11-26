import {
  getRequestResult,
  placeOrder,
  WebApiError,
  webOrderSchema,
  type PlaceOrderInput,
  type RequestResult,
  type WebOrder,
} from './webApi';

// Placing an order safely (BUILD_PLAN §5.1, AC29 for the website). One request
// key per checkout; when no definite answer arrives, the key is checked with
// the ERP before anything is reported, so a visitor never sees a false success
// and never places a blind duplicate.

export type PlaceOutcome =
  /** The ERP accepted the order. */
  | { kind: 'placed'; order: WebOrder }
  /** The ERP refused it (stable code); nothing was placed. */
  | { kind: 'rejected'; code: string }
  /** The answer was lost, and the check proved nothing was placed: retrying the same key is safe. */
  | { kind: 'not_placed' }
  /** Still unknown (the check failed too, or the order is mid-flight). Do not assume either way. */
  | { kind: 'unconfirmed' };

interface Deps {
  place: (input: PlaceOrderInput) => Promise<WebOrder>;
  check: (requestKey: string) => Promise<RequestResult>;
}

export async function placeWithCheck(
  input: PlaceOrderInput,
  deps: Deps = { place: placeOrder, check: getRequestResult },
): Promise<PlaceOutcome> {
  try {
    return { kind: 'placed', order: await deps.place(input) };
  } catch (err) {
    if (!(err instanceof WebApiError) || !err.uncertain) {
      return { kind: 'rejected', code: err instanceof WebApiError ? err.code : 'network' };
    }
  }
  try {
    const r = await deps.check(input.requestKey);
    if (r.status === 'not_found') return { kind: 'not_placed' };
    if (r.status === 'committed') {
      const order = webOrderSchema.safeParse(r.result);
      return order.success ? { kind: 'placed', order: order.data } : { kind: 'unconfirmed' };
    }
    return { kind: 'unconfirmed' };
  } catch {
    return { kind: 'unconfirmed' };
  }
}

const keyName = (locationId: string) => `matw.checkout.key.v1.${locationId}`;

/** The request key for this location's checkout, kept until the order is placed. */
export function checkoutKey(locationId: string): string {
  try {
    const existing = window.sessionStorage.getItem(keyName(locationId));
    if (existing) return existing;
    const key = crypto.randomUUID();
    window.sessionStorage.setItem(keyName(locationId), key);
    return key;
  } catch {
    return crypto.randomUUID();
  }
}

/** After a placed order: the next checkout must use a new key, or it would replay this one. */
export function forgetCheckoutKey(locationId: string): void {
  try {
    window.sessionStorage.removeItem(keyName(locationId));
  } catch {
    /* nothing stored */
  }
}
