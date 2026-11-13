-- 0002 Master data (PRD §5, §9, §14)
-- Units, items, standard costs, verified conversions, suppliers, supplier items,
-- location prices/taxes/settings, closures, reason codes and customers.

-- ---------------------------------------------------------------------------
-- Units. Conversions are allowed only within a dimension (mass↔mass,
-- volume↔volume) using these physical constants; anything across dimensions
-- requires an item-specific verified conversion (PRD §5, AC04).
-- ---------------------------------------------------------------------------
create table public.units (
  unit text primary key,
  dimension text not null check (dimension in ('mass', 'volume', 'count', 'serving')),
  factor_to_dimension_base numeric(24, 12) not null check (factor_to_dimension_base > 0),
  is_base boolean not null default false,
  description text not null
);

insert into public.units (unit, dimension, factor_to_dimension_base, is_base, description) values
  ('g', 'mass', 1, true, 'gram'),
  ('kg', 'mass', 1000, false, 'kilogram'),
  ('lb', 'mass', 453.59237, false, 'pound (avoirdupois)'),
  ('oz', 'mass', 28.349523125, false, 'ounce (avoirdupois)'),
  ('ml', 'volume', 1, true, 'milliliter'),
  ('l', 'volume', 1000, false, 'liter'),
  ('gal', 'volume', 3785.411784, false, 'US liquid gallon'),
  ('fl_oz', 'volume', 29.5735295625, false, 'US fluid ounce'),
  ('each', 'count', 1, true, 'each (decimal allowed for ingredients)'),
  ('serving', 'serving', 1, true, 'one menu serving');

-- ---------------------------------------------------------------------------
-- Suppliers (source identity preserved; missing real contacts stay NULL).
-- ---------------------------------------------------------------------------
create table public.suppliers (
  supplier_id text primary key check (supplier_id ~ '^SUP-[0-9]{2}$'),
  name text not null,
  supplier_type text,
  based_in text,
  phone text,
  address text,
  what_we_buy text,
  source_note text,
  contact_email text,
  contact_email_provenance text,
  contact_verification text not null default 'not independently verified',
  payment_terms_days integer check (payment_terms_days between 0 and 365),
  payment_terms_provenance text,
  source text not null,
  provenance text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint suppliers_terms_provenance check ((payment_terms_days is null) = (payment_terms_provenance is null)),
  constraint suppliers_email_provenance check ((contact_email is null) = (contact_email_provenance is null))
);

create trigger suppliers_no_synthetic_in_pilot
  before insert or update on public.suppliers
  for each row execute function private.guard_no_synthetic_in_pilot(
    'provenance', 'contact_email', 'contact_email_provenance', 'payment_terms_provenance');

-- ---------------------------------------------------------------------------
-- Items. Stable source IDs; barcode = item ID (internal Code 128, not a GTIN).
-- ---------------------------------------------------------------------------
create table public.items (
  item_id text primary key check (item_id ~ '^(ING|FG|RET)-[0-9]{3}$'),
  name text not null check (length(btrim(name)) > 0),
  item_type text not null check (item_type in ('ingredient', 'finished_dish', 'retail')),
  category text not null,
  base_unit text not null references public.units (unit) check (base_unit in ('g', 'ml', 'each', 'serving')),
  is_sellable boolean not null,
  is_purchasable boolean generated always as (item_type <> 'finished_dish') stored,
  requires_use_by boolean not null default false,
  requires_use_by_basis text not null default 'not_set',
  barcode text not null unique,
  barcode_type text not null default 'CODE128_INTERNAL' check (barcode_type = 'CODE128_INTERNAL'),
  storage_note text,
  source_note text,
  primary_supplier_id text references public.suppliers (supplier_id) on delete restrict,
  procurement_lead_days integer check (procurement_lead_days >= 0),
  prep_lead_days integer check (prep_lead_days >= 0),
  lead_time_basis text,
  lead_time_note text,
  source text not null,
  provenance text not null,
  provenance_detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint items_type_matches_prefix check (
    (item_type = 'ingredient') = (item_id like 'ING-%')
    and (item_type = 'finished_dish') = (item_id like 'FG-%')
    and (item_type = 'retail') = (item_id like 'RET-%')),
  constraint items_sellable_rule check (is_sellable = (item_type <> 'ingredient')),
  constraint items_dish_unit check ((item_type = 'finished_dish') = (base_unit = 'serving')),
  constraint items_barcode_is_id check (barcode = item_id),
  constraint items_dish_has_no_supplier check (item_type <> 'finished_dish' or primary_supplier_id is null),
  constraint items_type_unit_key unique (item_id, item_type, base_unit),
  constraint items_sellable_key unique (item_id, is_sellable),
  constraint items_purchasable_key unique (item_id, is_purchasable)
);

create trigger items_no_synthetic_in_pilot
  before insert or update on public.items
  for each row execute function private.guard_no_synthetic_in_pilot('provenance', 'item_id');

-- Standard/reference cost per base unit. Separate table so employees, who may
-- read item names, never see costs (PRD §4).
create table public.item_standard_costs (
  item_id text primary key references public.items (item_id) on delete restrict,
  standard_unit_cost numeric(18, 8) check (standard_unit_cost >= 0),
  reference_price_per_base numeric(18, 8) check (reference_price_per_base >= 0),
  cost_basis text not null,
  provenance text not null,
  updated_at timestamptz not null default now(),
  updated_by text references public.employees (employee_id) on delete restrict
);

create trigger item_standard_costs_no_synthetic_in_pilot
  before insert or update on public.item_standard_costs
  for each row execute function private.guard_no_synthetic_in_pilot('provenance', 'cost_basis');

-- Item-specific verified cross-dimension conversions (e.g. each → g for a
-- specific product). Never inferred.
create table public.item_unit_conversions (
  item_id text not null references public.items (item_id) on delete restrict,
  from_unit text not null references public.units (unit),
  base_qty_per_unit numeric(18, 8) not null check (base_qty_per_unit > 0),
  verified_by text not null references public.employees (employee_id) on delete restrict,
  verified_at timestamptz not null default now(),
  evidence_note text not null check (length(btrim(evidence_note)) > 0),
  primary key (item_id, from_unit)
);

-- Convert a quantity in any unit to the item's base unit, or raise
-- validation:unverified_conversion.
create function private.convert_to_base(p_item_id text, p_qty numeric, p_unit text)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_base_dim text;
  v_from_dim text;
  v_from_factor numeric;
  v_item_factor numeric;
begin
  select i.base_unit into v_base from public.items i where i.item_id = p_item_id;
  if v_base is null then
    perform private.raise_error('validation:unknown_item', jsonb_build_object('item_id', p_item_id));
  end if;
  if p_qty is null then
    perform private.raise_error('validation:quantity');
  end if;
  if lower(p_unit) = v_base then
    return p_qty;
  end if;
  select u.dimension, u.factor_to_dimension_base into v_from_dim, v_from_factor
  from public.units u where u.unit = lower(p_unit);
  if v_from_dim is null then
    perform private.raise_error('validation:unknown_unit', jsonb_build_object('unit', p_unit));
  end if;
  select u.dimension into v_base_dim from public.units u where u.unit = v_base;
  if v_from_dim = v_base_dim then
    return round(p_qty * v_from_factor, 6);
  end if;
  select c.base_qty_per_unit into v_item_factor
  from public.item_unit_conversions c
  where c.item_id = p_item_id and c.from_unit = lower(p_unit);
  if v_item_factor is null then
    perform private.raise_error('validation:unverified_conversion',
      jsonb_build_object('item_id', p_item_id, 'from_unit', p_unit, 'base_unit', v_base));
  end if;
  return round(p_qty * v_item_factor, 6);
end;
$$;

-- ---------------------------------------------------------------------------
-- Supplier ↔ item relations with pack-to-base conversion (PRD §9).
-- In the pilot, pack size and cost stay NULL until verified (setup gate).
-- ---------------------------------------------------------------------------
create table public.supplier_items (
  supplier_item_id uuid primary key default gen_random_uuid(),
  supplier_id text not null references public.suppliers (supplier_id) on delete restrict,
  item_id text not null,
  is_purchasable boolean not null default true check (is_purchasable),
  is_primary boolean not null default false,
  pack_description text,
  pack_base_qty numeric(18, 6) check (pack_base_qty > 0),
  pack_cost_cents bigint check (pack_cost_cents >= 0),
  unit_cost numeric(18, 8) check (unit_cost >= 0),
  cost_basis text check (cost_basis in ('quoted', 'estimated', 'synthetic_demo_assumption')),
  procurement_lead_days integer check (procurement_lead_days >= 0),
  lead_time_basis text,
  effective_date date,
  source text not null,
  provenance text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  foreign key (item_id, is_purchasable) references public.items (item_id, is_purchasable),
  constraint supplier_items_cost_basis check ((pack_cost_cents is null and unit_cost is null) = (cost_basis is null))
);

create unique index supplier_items_active_pair on public.supplier_items (supplier_id, item_id) where archived_at is null;
create unique index supplier_items_one_primary on public.supplier_items (item_id) where is_primary and archived_at is null;

create trigger supplier_items_no_synthetic_in_pilot
  before insert or update on public.supplier_items
  for each row execute function private.guard_no_synthetic_in_pilot('provenance', 'cost_basis');

-- ---------------------------------------------------------------------------
-- Location prices and taxes: effective-dated, append-only (PRD §5, §7).
-- Prices exist only for sellable items (composite FK).
-- ---------------------------------------------------------------------------
create table public.location_item_prices (
  location_id text not null references public.locations (location_id) on delete restrict,
  item_id text not null,
  is_sellable boolean not null default true check (is_sellable),
  price_cents bigint not null check (price_cents >= 0),
  effective_from date not null,
  provenance text not null,
  created_by text references public.employees (employee_id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (location_id, item_id, effective_from),
  foreign key (item_id, is_sellable) references public.items (item_id, is_sellable)
);

create trigger location_item_prices_append_only
  before update or delete on public.location_item_prices
  for each row execute function private.forbid_update_delete();
create trigger location_item_prices_no_synthetic_in_pilot
  before insert on public.location_item_prices
  for each row execute function private.guard_no_synthetic_in_pilot('provenance');

create table public.location_tax_rates (
  location_id text not null references public.locations (location_id) on delete restrict,
  effective_from date not null,
  rate numeric(7, 6) not null check (rate >= 0 and rate < 1),
  provenance text not null,
  confirmed_by text references public.employees (employee_id) on delete restrict,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (location_id, effective_from),
  constraint location_tax_rates_confirmation check ((confirmed_by is null) = (confirmed_at is null))
);

create trigger location_tax_rates_append_only
  before update or delete on public.location_tax_rates
  for each row execute function private.forbid_update_delete();
create trigger location_tax_rates_no_synthetic_in_pilot
  before insert on public.location_tax_rates
  for each row execute function private.guard_no_synthetic_in_pilot('provenance');

-- ---------------------------------------------------------------------------
-- Location/item planning settings (PRD §10). Units are stored with the values.
-- ---------------------------------------------------------------------------
create table public.location_item_settings (
  location_id text not null references public.locations (location_id) on delete restrict,
  item_id text not null references public.items (item_id) on delete restrict,
  reorder_applicable boolean not null,
  reorder_point_base numeric(18, 6) check (reorder_point_base >= 0),
  safety_stock_base numeric(18, 6) check (safety_stock_base >= 0),
  ordering_cost_cents bigint check (ordering_cost_cents >= 0),
  annual_holding_cost_per_base numeric(18, 8) check (annual_holding_cost_per_base >= 0),
  max_cover_days integer check (max_cover_days > 0),
  daily_demand_example_base numeric(18, 6) check (daily_demand_example_base >= 0),
  quantity_unit_basis text not null default 'item base unit',
  ordering_cost_unit text not null default 'USD cents per replenishment order',
  holding_cost_unit text not null default 'USD per base unit per year',
  provenance text not null,
  approved_by text references public.employees (employee_id) on delete restrict,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (location_id, item_id)
);

create trigger location_item_settings_no_synthetic_in_pilot
  before insert or update on public.location_item_settings
  for each row execute function private.guard_no_synthetic_in_pilot('provenance');

-- ---------------------------------------------------------------------------
-- Operating calendar (CLAUDE.md D9): a day is open unless listed here.
-- ---------------------------------------------------------------------------
create table public.location_closures (
  location_id text not null references public.locations (location_id) on delete restrict,
  business_date date not null,
  reason text not null check (length(btrim(reason)) > 0),
  created_by text references public.employees (employee_id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (location_id, business_date)
);

-- ---------------------------------------------------------------------------
-- Reason codes (PRD §6). Applicability is configurable; a reason never grants
-- permission or restores stock.
-- ---------------------------------------------------------------------------
create table public.reason_codes (
  code text primary key check (code ~ '^[A-Z_]+$'),
  description text not null,
  applies_to text[] not null,
  requires_note boolean not null default false,
  active boolean not null default true,
  constraint reason_codes_applies_to_valid check (
    applies_to <@ array['waste', 'cancellation', 'refund', 'return', 'count', 'transfer', 'receiving', 'correction']::text[]
    and cardinality(applies_to) > 0)
);

insert into public.reason_codes (code, description, applies_to, requires_note) values
  ('BURNT', 'Burnt during preparation', array['waste', 'cancellation'], false),
  ('EXPIRED', 'Past use-by date', array['waste', 'transfer', 'return'], false),
  ('SPOILAGE', 'Spoiled before use-by date', array['waste', 'transfer', 'return'], false),
  ('DAMAGED_SEAL', 'Packaging or seal damaged', array['waste', 'transfer', 'return', 'receiving'], false),
  ('PREP_ERROR', 'Preparation error', array['waste', 'cancellation'], false),
  ('CUSTOMER_COMPLAINT', 'Customer complaint', array['refund', 'return', 'cancellation'], false),
  ('WRONG_ITEM', 'Wrong item prepared, sold or received', array['waste', 'refund', 'return', 'cancellation', 'receiving'], false),
  ('COUNT_VARIANCE', 'Physical count variance', array['count', 'correction'], false),
  ('RECEIVING_ERROR', 'Receiving error', array['receiving', 'correction'], false),
  ('TRANSIT_LOSS', 'Lost or damaged in transit between locations', array['transfer'], false),
  ('OTHER', 'Other (note required)', array['waste', 'cancellation', 'refund', 'return', 'count', 'transfer', 'receiving', 'correction'], true);

-- ---------------------------------------------------------------------------
-- Customers: records attached to orders, not application users (PRD §4).
-- ---------------------------------------------------------------------------
create table public.customers (
  customer_id text primary key check (customer_id ~ '^[A-Z0-9][A-Z0-9-]{2,40}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  email text,
  phone text,
  provenance text not null,
  created_by text references public.employees (employee_id) on delete restrict,
  created_location_id text references public.locations (location_id) on delete restrict,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create trigger customers_no_synthetic_in_pilot
  before insert or update on public.customers
  for each row execute function private.guard_no_synthetic_in_pilot('provenance', 'email', 'customer_id');
