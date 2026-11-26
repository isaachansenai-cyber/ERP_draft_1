import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, Field, inputClass, Loading, MutationStatus, Notice, QueryError } from '../../components/ui';
import type { Database } from '../../lib/database.types';
import { useLocations } from '../../lib/referenceData';
import { supabase } from '../../lib/supabase';
import { useRpcMutation } from '../../lib/useRpcMutation';

// Settings → Website (owner; CLAUDE.md D12, BUILD_PLAN §3). Everything the
// public pickup website needs from the ERP: per-location ordering limits and
// opening hours, cook minutes per dish, and the text and allergen note per item.
// Forms are keyed by location or item only, so a save never remounts them and
// wipes the confirmation (the earlier recipe/supplier form bug).

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const keys = {
  settings: ['web-settings'],
  hours: ['web-hours'],
  items: ['web-items'],
  content: ['web-content'],
};

interface SettingsRow {
  location_id: string;
  enabled: boolean;
  orders_per_slot: number;
  days_ahead: number;
  max_per_line: number;
}
interface HoursRow {
  location_id: string;
  weekday: number;
  opens_at: string;
  closes_at: string;
}
interface ItemRow {
  item_id: string;
  name: string;
  item_type: 'finished_dish' | 'retail';
  prep_minutes: number | null;
  prep_lead_days: number | null;
  lead_time_note: string | null;
  is_sellable: boolean;
  archived_at: string | null;
}
interface ContentRow {
  item_id: string;
  country: string | null;
  description: string;
  image_path: string | null;
  allergen_note: string | null;
  allergen_reviewed_at: string | null;
  provenance: string;
}

function useTable<T>(key: string[], table: keyof Database['public']['Tables'], columns: string) {
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from(table).select(columns);
      if (error) throw error;
      return data as unknown as T[];
    },
  });
}

function LocationOrdering({
  locationId,
  name,
  row,
}: {
  locationId: string;
  name: string;
  row: SettingsRow | undefined;
}) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(row?.enabled ?? false);
  const [perSlot, setPerSlot] = useState(String(row?.orders_per_slot ?? 4));
  const [daysAhead, setDaysAhead] = useState(String(row?.days_ahead ?? 7));
  const [perLine, setPerLine] = useState(String(row?.max_per_line ?? 10));
  const m = useRpcMutation('set_web_ordering_settings', `web-settings:${locationId}`, {
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.settings }),
  });
  const id = (f: string) => `web-${f}-${locationId}`;
  return (
    <form
      className="grid gap-3 rounded-md border border-slate-400 bg-white p-3 sm:grid-cols-5 sm:items-end"
      aria-label={`Online ordering at ${name}`}
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({
          p_location_id: locationId,
          p_enabled: enabled,
          p_orders_per_slot: Number(perSlot),
          p_days_ahead: Number(daysAhead),
          p_max_per_line: Number(perLine),
        });
      }}
    >
      <p className="font-semibold sm:col-span-5">
        {name}{' '}
        {row ? (
          <Badge tone={row.enabled ? 'good' : 'neutral'}>{row.enabled ? 'Taking orders' : 'Paused'}</Badge>
        ) : (
          <Badge tone="warn">Not set up</Badge>
        )}
      </p>
      <label className="flex min-h-11 items-center gap-2 font-semibold">
        <input type="checkbox" className="h-5 w-5" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Take online orders
      </label>
      <Field label="Orders per 15-min slot" htmlFor={id('slot')}>
        <input
          id={id('slot')}
          type="number"
          min={1}
          max={50}
          className={inputClass}
          value={perSlot}
          onChange={(e) => setPerSlot(e.target.value)}
        />
      </Field>
      <Field label="Days ahead" htmlFor={id('days')}>
        <input
          id={id('days')}
          type="number"
          min={0}
          max={14}
          className={inputClass}
          value={daysAhead}
          onChange={(e) => setDaysAhead(e.target.value)}
        />
      </Field>
      <Field label="Most per item" htmlFor={id('line')}>
        <input
          id={id('line')}
          type="number"
          min={1}
          max={50}
          className={inputClass}
          value={perLine}
          onChange={(e) => setPerLine(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={!m.canPost}>
        Save
      </Button>
      <div className="sm:col-span-5">
        <MutationStatus
          state={m.state}
          successText={`Saved for ${name}.`}
          onRetry={() => void m.retry()}
          onCheckAgain={() => void m.checkAgain()}
        />
      </div>
    </form>
  );
}

function LocationHours({ locationId, name, rows }: { locationId: string; name: string; rows: HoursRow[] }) {
  const queryClient = useQueryClient();
  const initial = WEEKDAYS.map((_, i) => {
    const r = rows.find((h) => h.weekday === i + 1);
    return { open: !!r, opens: r?.opens_at.slice(0, 5) ?? '12:00', closes: r?.closes_at.slice(0, 5) ?? '20:00' };
  });
  const [days, setDays] = useState(initial);
  const m = useRpcMutation('set_location_opening_hours', `web-hours:${locationId}`, {
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.hours }),
  });
  const set = (i: number, patch: Partial<(typeof days)[number]>) =>
    setDays((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const valid = days.every((d) => !d.open || d.opens < d.closes);
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-3"
      aria-label={`Opening hours at ${name}`}
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({
          p_location_id: locationId,
          p_hours: days.flatMap((d, i) => (d.open ? [{ weekday: i + 1, opens_at: d.opens, closes_at: d.closes }] : [])),
        });
      }}
    >
      <p className="font-semibold">{name}</p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left">
            <th className="p-1">Day</th>
            <th className="p-1">Open</th>
            <th className="p-1">Opens</th>
            <th className="p-1">Closes</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d, i) => (
            <tr key={WEEKDAYS[i]} className="border-t border-slate-200">
              <td className="p-1">{WEEKDAYS[i]}</td>
              <td className="p-1">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  aria-label={`Open on ${WEEKDAYS[i]}`}
                  checked={d.open}
                  onChange={(e) => set(i, { open: e.target.checked })}
                />
              </td>
              <td className="p-1">
                <input
                  type="time"
                  aria-label={`${WEEKDAYS[i]} opens`}
                  className={inputClass}
                  disabled={!d.open}
                  value={d.opens}
                  onChange={(e) => set(i, { opens: e.target.value })}
                />
              </td>
              <td className="p-1">
                <input
                  type="time"
                  aria-label={`${WEEKDAYS[i]} closes`}
                  className={inputClass}
                  disabled={!d.open}
                  value={d.closes}
                  onChange={(e) => set(i, { closes: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!valid ? <p className="text-sm font-semibold text-red-800">Each open day must open before it closes.</p> : null}
      <div>
        <Button type="submit" disabled={!m.canPost || !valid}>
          Save hours
        </Button>
      </div>
      <MutationStatus
        state={m.state}
        successText={`Hours saved for ${name}.`}
        onRetry={() => void m.retry()}
        onCheckAgain={() => void m.checkAgain()}
      />
    </form>
  );
}

function CookTime({ item }: { item: ItemRow }) {
  const queryClient = useQueryClient();
  const [minutes, setMinutes] = useState(item.prep_minutes === null ? '' : String(item.prep_minutes));
  const m = useRpcMutation('set_item_prep_minutes', `web-prep:${item.item_id}`, {
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.items }),
  });
  const n = Number(minutes);
  return (
    <li className="flex flex-wrap items-end gap-3 border-t border-slate-200 py-2">
      <div className="mr-auto">
        <p className="font-semibold">{item.name}</p>
        <p className="text-xs text-slate-700">
          {(item.prep_lead_days ?? 0) > 0 ? `Needs ${item.prep_lead_days} day(s) of prep ahead. ` : ''}
          {item.lead_time_note ?? ''}
        </p>
      </div>
      <form
        className="flex items-end gap-2"
        aria-label={`Cook time for ${item.name}`}
        onSubmit={(e) => {
          e.preventDefault();
          void m.submit({ p_item_id: item.item_id, p_prep_minutes: n });
        }}
      >
        <Field label="Cook minutes on pickup day" htmlFor={`prep-${item.item_id}`}>
          <input
            id={`prep-${item.item_id}`}
            type="number"
            min={0}
            max={600}
            className={inputClass}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={!m.canPost || minutes === '' || !Number.isInteger(n) || n < 0 || n > 600}>
          Save
        </Button>
      </form>
      <div className="w-full">
        <MutationStatus
          state={m.state}
          successText="Cook time saved."
          onRetry={() => void m.retry()}
          onCheckAgain={() => void m.checkAgain()}
        />
      </div>
    </li>
  );
}

function ItemContent({ item, content }: { item: ItemRow; content: ContentRow | undefined }) {
  const queryClient = useQueryClient();
  const [country, setCountry] = useState(content?.country ?? '');
  const [description, setDescription] = useState(content?.description ?? '');
  const [allergen, setAllergen] = useState(content?.allergen_note ?? '');
  const [reviewed, setReviewed] = useState(Boolean(content?.allergen_reviewed_at));
  const m = useRpcMutation('set_web_menu_content', `web-content:${item.item_id}`, {
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.content }),
  });
  const id = (f: string) => `content-${f}-${item.item_id}`;
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-3"
      aria-label={`Website text for ${item.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({
          p_item_id: item.item_id,
          p_country: country.trim(),
          p_description: description.trim(),
          p_image_path: content?.image_path ?? '',
          p_allergen_note: allergen.trim(),
          p_allergen_reviewed: reviewed,
        });
      }}
    >
      <p className="font-semibold">
        {item.name}{' '}
        {!content ? (
          <Badge tone="warn">Not on the website</Badge>
        ) : content.allergen_reviewed_at ? (
          <Badge tone="good">Allergen note published</Badge>
        ) : (
          <Badge tone="neutral">Allergen note not reviewed: shows “please ask staff”</Badge>
        )}{' '}
        {content?.provenance.startsWith('synthetic') ? <Badge tone="warn">synthetic demo</Badge> : null}
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_3fr]">
        <Field label="Country" htmlFor={id('country')}>
          <input
            id={id('country')}
            className={inputClass}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          />
        </Field>
        <Field label="Description on the website" htmlFor={id('description')}>
          <input
            id={id('description')}
            className={inputClass}
            maxLength={400}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Allergen note (dairy, nuts, wheat)" htmlFor={id('allergen')}>
        <textarea
          id={id('allergen')}
          rows={2}
          maxLength={400}
          className={inputClass}
          value={allergen}
          onChange={(e) => setAllergen(e.target.value)}
        />
      </Field>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={reviewed}
          disabled={!allergen.trim()}
          onChange={(e) => setReviewed(e.target.checked)}
        />
        I have checked this allergen note against the real product labels. Publish it.
      </label>
      <div>
        <Button type="submit" disabled={!m.canPost || !description.trim()}>
          {content ? 'Save' : 'Add to the website'}
        </Button>
      </div>
      <MutationStatus
        state={m.state}
        successText="Website text saved."
        onRetry={() => void m.retry()}
        onCheckAgain={() => void m.checkAgain()}
      />
    </form>
  );
}

export function WebsitePanel() {
  const { context } = useAuth();
  const locations = useLocations();
  const settings = useTable<SettingsRow>(
    keys.settings,
    'web_ordering_settings',
    'location_id, enabled, orders_per_slot, days_ahead, max_per_line',
  );
  const hours = useTable<HoursRow>(keys.hours, 'location_opening_hours', 'location_id, weekday, opens_at, closes_at');
  const items = useTable<ItemRow>(
    keys.items,
    'items',
    'item_id, name, item_type, prep_minutes, prep_lead_days, lead_time_note, is_sellable, archived_at',
  );
  const content = useTable<ContentRow>(
    keys.content,
    'web_menu_content',
    'item_id, country, description, image_path, allergen_note, allergen_reviewed_at, provenance',
  );

  if (!context?.is_owner) {
    return <Notice tone="info">Only the owner can change the website settings.</Notice>;
  }
  const all = [locations, settings, hours, items, content];
  const failed = all.find((q) => q.error);
  if (failed) return <QueryError error={failed.error} onRetry={() => all.forEach((q) => void q.refetch())} />;
  if (all.some((q) => q.isPending)) return <Loading />;

  const sellable = items
    .data!.filter((i) => i.is_sellable && !i.archived_at)
    .sort((a, b) => a.item_id.localeCompare(b.item_id));
  const dishes = sellable.filter((i) => i.item_type === 'finished_dish');

  return (
    <div className="flex flex-col gap-6">
      <Notice tone="info" title="Public pickup website">
        These values drive the website. Each location takes online orders only when it is switched on here, has opening
        hours, and (in the pilot) the owner has confirmed “Website ordering ready” under Pilot setup.
      </Notice>

      <section aria-labelledby="web-ordering-heading" className="flex flex-col gap-3">
        <h2 id="web-ordering-heading" className="text-lg font-semibold">
          Online ordering by location
        </h2>
        {locations.data!.map((l) => (
          <LocationOrdering
            key={l.location_id}
            locationId={l.location_id}
            name={l.name}
            row={settings.data!.find((s) => s.location_id === l.location_id)}
          />
        ))}
      </section>

      <section aria-labelledby="web-hours-heading" className="flex flex-col gap-3">
        <h2 id="web-hours-heading" className="text-lg font-semibold">
          Opening hours (pickup times are offered only inside these)
        </h2>
        <div className="grid gap-3 lg:grid-cols-3">
          {locations.data!.map((l) => (
            <LocationHours
              key={l.location_id}
              locationId={l.location_id}
              name={l.name}
              rows={hours.data!.filter((h) => h.location_id === l.location_id)}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="web-prep-heading" className="flex flex-col gap-1">
        <h2 id="web-prep-heading" className="text-lg font-semibold">
          Cook times
        </h2>
        <p className="text-sm text-slate-700">
          Minutes from the kitchen starting (at opening) to the dish being ready. The website offers the earliest pickup
          time from the slowest dish in an order.
        </p>
        <ul className="rounded-md border border-slate-400 bg-white px-3">
          {dishes.map((i) => (
            <CookTime key={i.item_id} item={i} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="web-content-heading" className="flex flex-col gap-3">
        <h2 id="web-content-heading" className="text-lg font-semibold">
          Website text and allergen notes
        </h2>
        {sellable.map((i) => {
          const c = content.data!.find((x) => x.item_id === i.item_id);
          return <ItemContent key={i.item_id} item={i} content={c} />;
        })}
      </section>
    </div>
  );
}
