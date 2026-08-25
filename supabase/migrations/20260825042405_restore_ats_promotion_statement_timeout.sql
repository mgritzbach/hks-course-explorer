-- The meeting-interval migration replaced the public ATS promotion wrapper
-- after its function-scoped timeout had been configured. PostgreSQL keeps the
-- setting on the renamed implementation, but a newly created wrapper starts
-- without it and therefore inherits PostgREST's shorter API timeout. Restore
-- the existing 60-second bound on the callable wrapper without changing any
-- role, database, lock, or global timeout.

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
    raise exception 'ATS meeting wrapper timeout or search_path is unsafe';
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
    raise exception 'ATS meeting wrapper grants are unsafe';
  end if;
end
$$;
