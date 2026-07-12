-- Defense-in-depth for the Course Explorer browser roles.
--
-- RLS already denies unsupported writes. Revoke the underlying table grants as
-- a second boundary while preserving public catalogue reads and all
-- service_role/server-side sync authority. Existing rows are never changed.

do $$
begin
  if to_regclass('public.courses') is null then
    raise exception 'Refusing grant hardening: public.courses is missing';
  end if;
  if not (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'courses'
  ) then
    raise exception 'Refusing grant hardening: public.courses RLS is not enabled';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'courses' and cmd = 'SELECT'
  ) then
    raise exception 'Refusing grant hardening: public.courses has no SELECT policy';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'courses' and cmd <> 'SELECT'
  ) then
    raise exception 'Refusing grant hardening: public.courses has an unexpected write policy';
  end if;

  revoke insert, update, delete, truncate, references, trigger
    on table public.courses from anon, authenticated;
  grant select on table public.courses to anon, authenticated;

  if to_regclass('public.live_courses') is null then
    raise exception 'Refusing grant hardening: public.live_courses is missing';
  end if;
  if not (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'live_courses'
  ) then
    raise exception 'Refusing grant hardening: public.live_courses RLS is not enabled';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'live_courses' and cmd = 'SELECT'
  ) then
    raise exception 'Refusing grant hardening: public.live_courses has no SELECT policy';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'live_courses' and cmd <> 'SELECT'
  ) then
    raise exception 'Refusing grant hardening: public.live_courses has an unexpected write policy';
  end if;

  revoke insert, update, delete, truncate, references, trigger
    on table public.live_courses from anon, authenticated;
  grant select on table public.live_courses to anon, authenticated;

  if to_regclass('public.schedules') is null then
    raise exception 'Refusing grant hardening: public.schedules is missing';
  end if;
  if not (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'schedules'
  ) then
    raise exception 'Refusing grant hardening: public.schedules RLS is not enabled';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'schedules'
  ) then
    raise exception 'Refusing grant hardening: public.schedules has an unexpected policy';
  end if;

  revoke all privileges on table public.schedules from anon, authenticated;
end
$$;
