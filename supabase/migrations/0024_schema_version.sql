-- 0024 Schema version check (ADR 0036).
--
-- The hosted demo once received a frontend that called functions from
-- migration 0023 while its database was still at 0022, so two screens failed
-- with no useful message. The app now asks the database which migration it is
-- at and shows a banner when the two disagree.
--
-- Every later migration re-creates this function with its own number
-- (create or replace). Signed-in users only: the anonymous API surface stays
-- limited to get_public_app_mode (001_schema_security).

create function public.get_schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 24;
$$;

revoke all on function public.get_schema_version() from public;
revoke all on function public.get_schema_version() from anon;
grant execute on function public.get_schema_version() to authenticated;
