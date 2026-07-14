-- The complete ATS catalogue promotion is intentionally one transaction so
-- readers never see a partial catalogue. Production currently processes more
-- than 6,000 offerings, which can exceed the authenticator role's eight-second
-- API default. Supabase supports a function-level timeout for exactly this
-- recurring-RPC case. Keep the global and role timeouts unchanged, and bound
-- only this internal service-role function to the platform's 60-second API
-- ceiling. The existing lock_timeout remains unchanged and still fails closed
-- if the catalogue promotion cannot obtain a lock promptly.

alter function public.sync_live_courses_atomically(jsonb)
  set statement_timeout to '60s';

do $$
declare
  function_config text[];
begin
  select procedure_definition.proconfig
    into function_config
    from pg_catalog.pg_proc as procedure_definition
   where procedure_definition.oid =
     pg_catalog.to_regprocedure('public.sync_live_courses_atomically(jsonb)');

  if function_config is null
     or not function_config @> array['search_path=""']
     or not function_config @> array['statement_timeout=60s'] then
    raise exception 'ATS promotion function timeout or search_path is unsafe';
  end if;

  if pg_catalog.has_function_privilege(
       'anon', 'public.sync_live_courses_atomically(jsonb)', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated', 'public.sync_live_courses_atomically(jsonb)', 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role', 'public.sync_live_courses_atomically(jsonb)', 'EXECUTE'
     ) then
    raise exception 'ATS promotion function grants are unsafe';
  end if;
end
$$;
