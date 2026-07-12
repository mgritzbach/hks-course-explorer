-- Close residual PostgreSQL 15+ MAINTAIN and trigger-function execution
-- grants left by older ALL-privilege grants. Browsers need catalogue SELECT,
-- not VACUUM/ANALYZE/REINDEX/CLUSTER/LOCK authority, and trigger functions are
-- invoked by PostgreSQL rather than directly by browser roles.

do $$
declare
  scoped_table text;
  trigger_function text;
begin
  foreach scoped_table in array array[
    'courses', 'course_sections', 'schedules', 'live_catalogue_runs', 'live_courses'
  ] loop
    if to_regclass('public.' || scoped_table) is null then
      raise exception 'Privilege hardening target public.% is missing', scoped_table;
    end if;
    execute format(
      'revoke maintain on table public.%I from anon, authenticated', scoped_table
    );
    execute format(
      'grant maintain on table public.%I to service_role', scoped_table
    );
    if has_table_privilege('anon', 'public.' || scoped_table, 'MAINTAIN')
       or has_table_privilege('authenticated', 'public.' || scoped_table, 'MAINTAIN')
       or not has_table_privilege('service_role', 'public.' || scoped_table, 'MAINTAIN') then
      raise exception 'MAINTAIN privilege hardening failed on public.%', scoped_table;
    end if;
  end loop;

  foreach trigger_function in array array[
    'public.refresh_synced_at()',
    'public.keep_ats_hks_inactive_after_myharvard()'
  ] loop
    if to_regprocedure(trigger_function) is null then
      raise exception 'Trigger function % is missing', trigger_function;
    end if;
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      trigger_function
    );
    execute format(
      'grant execute on function %s to service_role',
      trigger_function
    );
    if has_function_privilege('anon', trigger_function, 'EXECUTE')
       or has_function_privilege('authenticated', trigger_function, 'EXECUTE')
       or not has_function_privilege('service_role', trigger_function, 'EXECUTE') then
      raise exception 'Trigger-function privilege hardening failed on %', trigger_function;
    end if;
  end loop;
end
$$;
