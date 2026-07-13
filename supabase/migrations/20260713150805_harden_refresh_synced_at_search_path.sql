-- Pin the trigger function to the system catalogue so caller-controlled role
-- settings cannot influence name resolution. The function reads no application
-- object; NEW is supplied by PostgreSQL and now() resolves from pg_catalog.
--
-- Rollback (configuration only; no row or trigger change):
--   alter function public.refresh_synced_at() reset search_path;

do $$
begin
  if to_regprocedure('public.refresh_synced_at()') is null then
    raise exception 'Search-path hardening target public.refresh_synced_at() is missing';
  end if;
end
$$;

alter function public.refresh_synced_at()
  set search_path = pg_catalog;

do $$
begin
  if not coalesce((
    select proconfig @> array['search_path=pg_catalog']
    from pg_proc
    where oid = to_regprocedure('public.refresh_synced_at()')
  ), false) then
    raise exception 'Search-path hardening failed for public.refresh_synced_at()';
  end if;
end
$$;
