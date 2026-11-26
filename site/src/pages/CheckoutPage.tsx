import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { LinkButton, LoadFailure, Notice, PageHeader, TextLink } from '../components/ui';
import { priceCart } from '../lib/cart';
import { placementMessage, type ContactField } from '../lib/describe';
import { estimateOrder, formatCents, formatRate } from '../lib/money';
import { checkoutKey, forgetCheckoutKey, placeWithCheck, type PlaceOutcome } from '../lib/placement';
import { useAppMode, useLocations, useMenu } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { formatDay, formatTime, groupByDay } from '../lib/time';
import { getRequestResult, getSlots, WebApiError, webOrderSchema } from '../lib/webApi';
import { useShop } from '../state/shop';

// Client-side checks mirror the ERP's for a quicker answer; the ERP checks again.
const contactSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name.').max(80, 'Please keep your name to 80 characters.'),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+() .-]{7,20}$/, 'Please enter a phone number we can call.')
    .refine((p) => p.replace(/[^0-9]/g, '').length >= 7, 'Please enter a phone number we can call.'),
  email: z
    .string()
    .trim()
    .max(120, 'Please enter a shorter e-mail address.')
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Please enter a valid e-mail address.'),
  note: z.string().max(300, 'Please keep the note to 300 characters.'),
});

const inputClass =
  'min-h-11 w-full rounded-lg border-2 border-charcoal/30 bg-paper px-3 py-2 text-base focus-visible:outline focus-visible:outline-4 focus-visible:outline-ultramarine aria-[invalid=true]:border-brick';

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} className="font-semibold text-brick">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type Status =
  | { state: 'idle' }
  | { state: 'placing' }
  | { state: 'checking' }
  | { state: 'refused'; text: string }
  | { state: 'not_placed' }
  | { state: 'unconfirmed' };

export function CheckoutPage() {
  const { locationId, lines, clearCart } = useShop();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const menu = useMenu(supabase ? locationId : null);
  const locations = useLocations();
  const mode = useAppMode();
  const itemIds = [...new Set(lines.map((l) => l.item_id))].sort();
  const slots = useQuery({
    queryKey: ['web', 'slots', locationId, itemIds],
    queryFn: () => getSlots(locationId!, itemIds),
    enabled: !!supabase && !!locationId && itemIds.length > 0,
    refetchInterval: 60_000,
  });

  const [day, setDay] = useState('');
  const [pickupAt, setPickupAt] = useState('');
  const [contact, setContact] = useState({ name: '', phone: '', email: '', note: '' });
  const [errors, setErrors] = useState<Partial<Record<ContactField | 'pickup', string>>>({});
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const busy = status.state === 'placing' || status.state === 'checking';
  const locationName = locations.data?.find((l) => l.location_id === locationId)?.name;

  const header = (
    <PageHeader
      eyebrow="Pickup order"
      title="Checkout"
      intro={locationName ? `Pickup at ${locationName}.` : undefined}
    />
  );
  const frame = (body: ReactNode) => (
    <>
      {header}
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 md:px-8">{body}</div>
    </>
  );

  if (!supabase) return frame(<LoadFailure error={new WebApiError('not_configured')} />);
  if (!locationId || lines.length === 0) {
    return frame(
      <>
        <p className="text-lg">Your cart is empty, so there is nothing to check out.</p>
        <p>
          <LinkButton to="/menu">Browse the menu</LinkButton>
        </p>
      </>,
    );
  }
  if (menu.isPending) return frame(<p role="status">Checking prices and availability…</p>);
  if (menu.isError) return frame(<LoadFailure error={menu.error} onRetry={() => void menu.refetch()} />);

  const cart = priceCart(lines, menu.data.items);
  if (!menu.data.ordering_open || !cart.ok || menu.data.tax_rate === null) {
    return frame(
      <>
        <Notice title="Your cart needs attention first">
          {!menu.data.ordering_open
            ? 'This location is not taking online orders right now.'
            : 'Some items changed since you added them.'}
        </Notice>
        <p>
          <TextLink to="/cart">Back to your cart</TextLink>
        </p>
      </>,
    );
  }

  const estimate = estimateOrder(
    cart.lines.map((l) => ({ unitCents: l.item!.price_cents!, quantity: l.quantity })),
    menu.data.tax_rate,
  );
  const demo = mode.data?.data_mode === 'demo';
  const days = groupByDay(slots.data?.slots ?? []);
  const daySlots = days.find((d) => d.day === day)?.slots ?? [];

  const finish = (outcome: PlaceOutcome) => {
    switch (outcome.kind) {
      case 'placed':
        forgetCheckoutKey(locationId);
        clearCart();
        void queryClient.invalidateQueries({ queryKey: ['web', 'menu', locationId] });
        navigate(`/order/${outcome.order.web_token}`);
        return;
      case 'rejected': {
        const m = placementMessage(outcome.code);
        if (m.field) setErrors({ [m.field]: m.text });
        if (m.refresh === 'menu') void queryClient.invalidateQueries({ queryKey: ['web', 'menu', locationId] });
        if (m.refresh === 'slots') {
          setPickupAt('');
          void slots.refetch();
        }
        setStatus({ state: 'refused', text: m.text });
        return;
      }
      default:
        setStatus({ state: outcome.kind });
    }
  };

  const submit = async () => {
    const parsed = contactSchema.safeParse(contact);
    const next: typeof errors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) next[issue.path[0] as ContactField] ??= issue.message;
    }
    if (!pickupAt) next.pickup = 'Please choose a pickup time.';
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed.success) return;
    setStatus({ state: 'placing' });
    finish(
      await placeWithCheck({
        requestKey: checkoutKey(locationId),
        locationId,
        lines: lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity })),
        contact: { name: parsed.data.name, phone: parsed.data.phone, email: parsed.data.email },
        pickupAt,
        note: parsed.data.note.trim() || null,
      }),
    );
  };

  const checkAgain = async () => {
    setStatus({ state: 'checking' });
    try {
      const r = await getRequestResult(checkoutKey(locationId));
      if (r.status === 'committed') {
        const order = webOrderSchema.safeParse(r.result);
        finish(order.success ? { kind: 'placed', order: order.data } : { kind: 'unconfirmed' });
      } else {
        finish({ kind: r.status === 'not_found' ? 'not_placed' : 'unconfirmed' });
      }
    } catch {
      finish({ kind: 'unconfirmed' });
    }
  };

  const describedBy = (id: string, hint = false) =>
    [hint ? `${id}-hint` : '', errors[id as ContactField] ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;

  return frame(
    <form
      noValidate
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void submit();
      }}
    >
      <section aria-labelledby="summary-heading" className="flex flex-col gap-2">
        <h2 id="summary-heading" className="font-display text-2xl font-bold">
          Your order
        </h2>
        <ul className="divide-y divide-charcoal/15">
          {cart.lines.map((l) => (
            <li key={l.item_id} className="flex justify-between gap-4 py-2">
              <span>
                {l.quantity} × {l.item!.name}
              </span>
              <span className="font-semibold">{formatCents(l.lineCents!)}</span>
            </li>
          ))}
        </ul>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t-2 border-charcoal/30 pt-2">
          <dt>Subtotal</dt>
          <dd className="text-right">{formatCents(estimate.subtotalCents)}</dd>
          <dt>Sales tax ({formatRate(menu.data.tax_rate)})</dt>
          <dd className="text-right">{formatCents(estimate.taxCents)}</dd>
          <dt className="text-xl font-bold">Total</dt>
          <dd className="text-right text-xl font-bold" data-testid="checkout-total">
            {formatCents(estimate.totalCents)}
          </dd>
        </dl>
        <p className="text-sm">
          <TextLink to="/cart">Change your cart</TextLink>
        </p>
      </section>

      <section aria-labelledby="pickup-heading" className="flex flex-col gap-3">
        <h2 id="pickup-heading" className="font-display text-2xl font-bold">
          Pickup time
        </h2>
        {slots.isPending ? (
          <p role="status">Finding pickup times…</p>
        ) : slots.isError ? (
          <LoadFailure error={slots.error} onRetry={() => void slots.refetch()} />
        ) : days.length === 0 ? (
          <Notice title="No pickup times available">
            We have no open pickup times for these items in the next week. Please call us.
          </Notice>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pickup-day" label="Day">
              <select
                id="pickup-day"
                className={inputClass}
                value={day}
                onChange={(e) => {
                  setDay(e.target.value);
                  setPickupAt('');
                }}
              >
                <option value="">Choose a day</option>
                {days.map((d) => (
                  <option key={d.day} value={d.day} disabled={!d.slots.some((s) => s.available)}>
                    {formatDay(d.slots[0]!.pickup_at)}
                    {d.slots.some((s) => s.available) ? '' : ' (full)'}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="pickup-time" label="Time" error={errors.pickup}>
              <select
                id="pickup-time"
                className={inputClass}
                value={pickupAt}
                disabled={!day}
                aria-invalid={!!errors.pickup}
                aria-describedby={errors.pickup ? 'pickup-time-error' : undefined}
                onChange={(e) => setPickupAt(e.target.value)}
              >
                <option value="">{day ? 'Choose a time' : 'Choose a day first'}</option>
                {daySlots.map((s) => (
                  <option key={s.pickup_at} value={s.pickup_at} disabled={!s.available}>
                    {formatTime(s.pickup_at)}
                    {s.available ? '' : ' (full)'}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-sm text-muted sm:col-span-2">
              The earliest time depends on the slowest dish in your order. Times are in Mountain Time.
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="contact-heading" className="flex flex-col gap-4">
        <h2 id="contact-heading" className="font-display text-2xl font-bold">
          Your details
        </h2>
        <p className="text-sm text-muted">We use these only to reach you about this order.</p>
        <Field id="name" label="Name for pickup" error={errors.name}>
          <input
            id="name"
            autoComplete="name"
            className={inputClass}
            value={contact.name}
            aria-invalid={!!errors.name}
            aria-describedby={describedBy('name')}
            onChange={(e) => setContact({ ...contact, name: e.target.value })}
          />
        </Field>
        <Field id="phone" label="Phone" error={errors.phone}>
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            className={inputClass}
            value={contact.phone}
            aria-invalid={!!errors.phone}
            aria-describedby={describedBy('phone')}
            onChange={(e) => setContact({ ...contact, phone: e.target.value })}
          />
        </Field>
        <Field id="email" label="E-mail" error={errors.email}>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className={inputClass}
            value={contact.email}
            aria-invalid={!!errors.email}
            aria-describedby={describedBy('email')}
            onChange={(e) => setContact({ ...contact, email: e.target.value })}
          />
        </Field>
        <Field id="note" label="Note for the kitchen (optional)" error={errors.note} hint="Up to 300 characters.">
          <textarea
            id="note"
            rows={3}
            className={inputClass}
            value={contact.note}
            aria-invalid={!!errors.note}
            aria-describedby={describedBy('note', true)}
            onChange={(e) => setContact({ ...contact, note: e.target.value })}
          />
        </Field>
      </section>

      <section aria-labelledby="payment-heading" className="flex flex-col gap-3">
        <h2 id="payment-heading" className="font-display text-2xl font-bold">
          Payment
        </h2>
        {mode.isPending ? (
          <p role="status">Loading…</p>
        ) : demo ? (
          <Notice title="Simulated payment (demo)">
            This is a demonstration. Placing the order records a simulated payment of {formatCents(estimate.totalCents)}
            . No card is charged, and no card details are asked for.
          </Notice>
        ) : (
          <Notice title="Pay at pickup">
            You pay {formatCents(estimate.totalCents)} at the counter when you collect your order. We never ask for card
            details on this website.
          </Notice>
        )}
      </section>

      <div className="flex flex-col gap-3" aria-live="polite">
        {status.state === 'refused' ? (
          <p role="alert" className="font-semibold text-brick">
            {status.text}
          </p>
        ) : null}
        {status.state === 'not_placed' ? (
          <p role="alert" className="font-semibold text-brick">
            The connection dropped before your order reached us, so it was not placed. You can safely try again.
          </p>
        ) : null}
        {status.state === 'unconfirmed' ? (
          <div role="alert" className="flex flex-col gap-2 font-semibold text-brick">
            <p>We could not confirm whether your order went through. Please do not order again yet.</p>
            <p>
              <button
                type="button"
                onClick={() => void checkAgain()}
                className="inline-flex min-h-11 items-center rounded-full bg-charcoal px-5 font-semibold text-cream focus-visible:outline focus-visible:outline-4 focus-visible:outline-ultramarine"
              >
                Check again
              </button>
            </p>
          </div>
        ) : null}
        {busy ? (
          <p role="status">{status.state === 'checking' ? 'Checking with the restaurant…' : 'Placing your order…'}</p>
        ) : null}
        <button
          type="submit"
          disabled={busy || mode.isPending || status.state === 'unconfirmed'}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-brick px-8 py-3 text-lg font-bold text-paper hover:bg-charcoal disabled:opacity-50 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ultramarine"
        >
          {demo
            ? `Place order · ${formatCents(estimate.totalCents)}`
            : `Place order · pay ${formatCents(estimate.totalCents)} at pickup`}
        </button>
      </div>
    </form>,
  );
}
