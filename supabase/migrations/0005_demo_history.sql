-- 0005 Demo historical sales snapshots (PRD §14, §16, AC34).
-- Read-only import snapshots keyed by (dataset_id, source key). They never post
-- inventory, AP, tenders or timecards, and can only be inserted while the
-- database is in demo mode.

create table public.historical_sales_orders (
  dataset_id text not null,
  historical_order_id text not null,
  business_date date not null,
  created_at_local timestamp not null,
  created_at timestamptz generated always as (created_at_local at time zone 'America/Denver') stored,
  timezone text not null check (timezone = 'America/Denver'),
  location_id text not null references public.locations (location_id) on delete restrict,
  customer_id text references public.customers (customer_id) on delete restrict,
  status text not null check (status = 'completed'),
  net_before_refund_cents bigint not null check (net_before_refund_cents >= 0),
  tax_before_refund_cents bigint not null check (tax_before_refund_cents >= 0),
  refund_net_cents bigint not null check (refund_net_cents >= 0),
  refund_tax_cents bigint not null check (refund_tax_cents >= 0),
  historical_cogs_cents bigint not null check (historical_cogs_cents >= 0),
  payment_mode text not null check (payment_mode = 'SIMULATED'),
  provenance text not null check (provenance ilike 'synthetic%'),
  imported_at timestamptz not null default now(),
  primary key (dataset_id, historical_order_id),
  constraint historical_orders_refund_bounds check (
    refund_net_cents <= net_before_refund_cents and refund_tax_cents <= tax_before_refund_cents),
  constraint historical_orders_business_date check (business_date = created_at_local::date)
);

create index historical_sales_orders_loc_date on public.historical_sales_orders (location_id, business_date);

create table public.historical_sales_lines (
  dataset_id text not null,
  historical_order_id text not null,
  line_no integer not null check (line_no > 0),
  business_date date not null,
  location_id text not null references public.locations (location_id) on delete restrict,
  customer_id text references public.customers (customer_id) on delete restrict,
  item_id text not null,
  is_sellable boolean not null default true check (is_sellable),
  quantity_fulfilled integer not null check (quantity_fulfilled > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  discount_cents bigint not null check (discount_cents >= 0),
  net_before_refund_cents bigint not null check (net_before_refund_cents >= 0),
  tax_before_refund_cents bigint not null check (tax_before_refund_cents >= 0),
  refund_net_cents bigint not null check (refund_net_cents >= 0),
  refund_tax_cents bigint not null check (refund_tax_cents >= 0),
  historical_cogs_cents bigint not null check (historical_cogs_cents >= 0),
  payment_mode text not null check (payment_mode = 'SIMULATED'),
  provenance text not null check (provenance ilike 'synthetic%'),
  imported_at timestamptz not null default now(),
  primary key (dataset_id, historical_order_id, line_no),
  foreign key (dataset_id, historical_order_id)
    references public.historical_sales_orders (dataset_id, historical_order_id) on delete restrict,
  foreign key (item_id, is_sellable) references public.items (item_id, is_sellable),
  constraint historical_lines_net check (
    net_before_refund_cents = quantity_fulfilled * unit_price_cents - discount_cents),
  constraint historical_lines_refund_bounds check (
    refund_net_cents <= net_before_refund_cents and refund_tax_cents <= tax_before_refund_cents)
);

create index historical_sales_lines_loc_date on public.historical_sales_lines (location_id, business_date);
create index historical_sales_lines_item on public.historical_sales_lines (item_id, business_date);

-- Demo-only inserts; immutable afterwards; truncate only in demo (reset).
create function private.historical_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select s.data_mode from public.app_settings s) <> 'demo' then
    perform private.raise_error('forbidden:synthetic_data_in_pilot',
      jsonb_build_object('table', tg_table_name));
  end if;
  if new.dataset_id is distinct from (select s.dataset_id from public.app_settings s) then
    perform private.raise_error('validation:dataset_id_mismatch',
      jsonb_build_object('dataset_id', new.dataset_id));
  end if;
  return new;
end;
$$;

create trigger historical_sales_orders_insert_guard
  before insert on public.historical_sales_orders
  for each row execute function private.historical_insert_guard();
create trigger historical_sales_lines_insert_guard
  before insert on public.historical_sales_lines
  for each row execute function private.historical_insert_guard();

create trigger historical_sales_orders_immutable
  before update or delete on public.historical_sales_orders
  for each row execute function private.forbid_update_delete();
create trigger historical_sales_lines_immutable
  before update or delete on public.historical_sales_lines
  for each row execute function private.forbid_update_delete();

create trigger historical_sales_orders_no_truncate
  before truncate on public.historical_sales_orders
  for each statement execute function private.forbid_truncate_outside_demo();
create trigger historical_sales_lines_no_truncate
  before truncate on public.historical_sales_lines
  for each statement execute function private.forbid_truncate_outside_demo();
