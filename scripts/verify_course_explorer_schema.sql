\set ON_ERROR_STOP on

do $$
declare
  active_run public.live_catalogue_runs%rowtype;
  active_ats_run public.live_catalogue_runs%rowtype;
  active_ats_run_count integer;
  actual_digest text;
  actual_terms jsonb;
  actual_rows integer;
  scoped_table text;
  service_rpc text;
  trigger_function text;
  required_privilege text;
  actual_manifest_columns text[];
begin
  foreach scoped_table in array array[
    'courses', 'course_sections', 'schedules', 'live_catalogue_runs', 'live_courses'
  ] loop
    if to_regclass('public.' || scoped_table) is null then
      raise exception 'Recovery schema is missing public.%', scoped_table;
    end if;
    if not (
      select relrowsecurity from pg_class
      where oid = to_regclass('public.' || scoped_table)
    ) then
      raise exception 'Recovery schema has RLS disabled on public.%', scoped_table;
    end if;
  end loop;

  if (select count(*) from pg_policies where schemaname='public' and tablename='courses') <> 1
     or not exists (
       select 1 from pg_policies where schemaname='public' and tablename='courses'
       and policyname='Public read' and permissive='PERMISSIVE' and cmd='SELECT'
       and roles='{public}' and qual='true' and with_check is null
     ) then
    raise exception 'Recovery courses policy contract does not match production';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='course_sections') <> 1
     or not exists (
       select 1 from pg_policies where schemaname='public' and tablename='course_sections'
       and policyname='Public read' and permissive='PERMISSIVE' and cmd='SELECT'
       and roles='{public}' and qual='true' and with_check is null
     ) then
    raise exception 'Recovery course_sections policy contract does not match production';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='live_courses') <> 1
     or not exists (
       select 1 from pg_policies where schemaname='public' and tablename='live_courses'
       and policyname='Public read' and permissive='PERMISSIVE' and cmd='SELECT'
       and roles='{public}' and qual='active' and with_check is null
     ) then
    raise exception 'Recovery live_courses policy contract does not match production';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='schedules') then
    raise exception 'Recovery schedules table unexpectedly has a browser policy';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='live_catalogue_runs') <> 1
     or not exists (
       select 1 from pg_policies where schemaname='public' and tablename='live_catalogue_runs'
       and policyname='Publishable read active myharvard manifest'
       and roles='{anon}' and cmd='SELECT'
       and qual='((source = ''myharvard''::text) AND (status = ''active''::text))'
     ) then
    raise exception 'Recovery live_catalogue_runs policy contract does not match production';
  end if;

  foreach scoped_table in array array['courses','course_sections','live_courses'] loop
    if not has_table_privilege('anon', 'public.' || scoped_table, 'SELECT')
       or not has_table_privilege('authenticated', 'public.' || scoped_table, 'SELECT') then
      raise exception 'Recovery browser SELECT is missing on public.%', scoped_table;
    end if;
    if has_table_privilege('anon', 'public.' || scoped_table, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
       or has_table_privilege('authenticated', 'public.' || scoped_table, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
      raise exception 'Recovery browser write privilege exists on public.%', scoped_table;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.schedules', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     or has_table_privilege('authenticated', 'public.schedules', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'Recovery browser privilege exists on public.schedules';
  end if;
  if has_table_privilege('anon', 'public.live_catalogue_runs', 'SELECT') then
    raise exception 'Recovery live_catalogue_runs accidentally has table-wide anon SELECT';
  end if;
  if not has_column_privilege('anon', 'public.live_catalogue_runs', 'identity_sha256', 'SELECT')
     or has_column_privilege('anon', 'public.live_catalogue_runs', 'created_at', 'SELECT') then
    raise exception 'Recovery live_catalogue_runs column grants do not match production';
  end if;

  foreach scoped_table in array array[
    'courses', 'course_sections', 'schedules', 'live_catalogue_runs', 'live_courses'
  ] loop
    foreach required_privilege in array array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER',
      'MAINTAIN'
    ] loop
      if not has_table_privilege(
        'service_role', 'public.' || scoped_table, required_privilege
      ) then
        raise exception 'Recovery service_role lost % on public.%',
          required_privilege, scoped_table;
      end if;
    end loop;
  end loop;

  if has_table_privilege('authenticated', 'public.live_catalogue_runs',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     or has_table_privilege('anon', 'public.live_catalogue_runs',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'Recovery live_catalogue_runs browser grants are unsafe';
  end if;
  select coalesce(
      array_agg(cp.column_name::text order by col.ordinal_position),
      array[]::text[]
    )
    into actual_manifest_columns
    from information_schema.column_privileges cp
    join information_schema.columns col
      on col.table_schema = cp.table_schema
     and col.table_name = cp.table_name
     and col.column_name = cp.column_name
   where cp.table_schema='public' and cp.table_name='live_catalogue_runs'
     and cp.grantee='anon' and cp.privilege_type='SELECT';
  if actual_manifest_columns <> array[
    'id', 'source', 'status', 'offering_count', 'source_snapshot_at',
    'activated_at', 'identity_sha256', 'term_counts'
  ]::text[] then
    raise exception 'Recovery live_catalogue_runs anon column grant set drifted: %',
      actual_manifest_columns;
  end if;

  if to_regclass('public.live_courses_run_offering_identity') is null
     or to_regclass('public.live_courses_active_term_school_idx') is null
     or to_regclass('public.live_courses_sync_run_idx') is null
     or to_regclass('public.live_catalogue_runs_one_active_myharvard') is null
     or to_regclass('public.live_catalogue_runs_one_active_ats') is null
     or to_regclass('public.live_courses_source_active_term_idx') is null
     or to_regclass('public.course_sections_course_code_base_term_idx') is null then
    raise exception 'Recovery schema is missing a required operational index';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.live_courses'::regclass
      and conname='live_courses_sync_run_id_fkey'
      and contype='f' and convalidated
  ) then
    raise exception 'Recovery live_courses parent relationship is missing';
  end if;
  if exists (
    select 1
      from public.live_courses as course
      left join public.live_catalogue_runs as run on run.id = course.sync_run_id
     where course.sync_run_id is not null and run.id is null
  ) then
    raise exception 'Recovery live_courses contains an orphaned sync_run_id';
  end if;

  if to_regprocedure('public.sync_live_courses_atomically(jsonb)') is null
     or to_regprocedure('public.stage_myharvard_hks_offerings(uuid,jsonb)') is null
     or to_regprocedure('public.promote_myharvard_hks_run(uuid)') is null
     or to_regprocedure('public.rollback_myharvard_hks_run(uuid)') is null then
    raise exception 'Recovery schema is missing a catalogue RPC';
  end if;
  foreach service_rpc in array array[
    'public.sync_live_courses_atomically(jsonb)',
    'public.stage_myharvard_hks_offerings(uuid,jsonb)',
    'public.promote_myharvard_hks_run(uuid)',
    'public.rollback_myharvard_hks_run(uuid)'
  ] loop
    if has_function_privilege('anon', service_rpc, 'EXECUTE')
       or has_function_privilege('authenticated', service_rpc, 'EXECUTE')
       or not has_function_privilege('service_role', service_rpc, 'EXECUTE') then
      raise exception 'Recovery service RPC grants are unsafe for %', service_rpc;
    end if;
    if service_rpc = 'public.sync_live_courses_atomically(jsonb)' and not (
      select prosecdef
        and (
          coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
          or coalesce(proconfig, '{}'::text[]) @> array['search_path=']
        )
        and coalesce(proconfig, '{}'::text[]) @> array['statement_timeout=60s']
      from pg_proc where oid=to_regprocedure(service_rpc)
    ) then
      raise exception 'Recovery service RPC execution context is unsafe for %', service_rpc;
    elsif service_rpc <> 'public.sync_live_courses_atomically(jsonb)' and not (
      select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=public']
      from pg_proc where oid=to_regprocedure(service_rpc)
    ) then
      raise exception 'Recovery service RPC execution context is unsafe for %', service_rpc;
    end if;
  end loop;
  if not exists (
    select 1 from information_schema.triggers
    where trigger_schema='public' and event_object_table='live_courses'
      and trigger_name='keep_ats_hks_inactive_after_myharvard'
  ) or not exists (
    select 1 from information_schema.triggers
    where trigger_schema='public' and event_object_table='live_courses'
      and trigger_name='live_courses_refresh_synced_at'
  ) then
    raise exception 'Recovery live_courses triggers are incomplete';
  end if;
  foreach trigger_function in array array[
    'public.refresh_synced_at()',
    'public.keep_ats_hks_inactive_after_myharvard()'
  ] loop
    if has_function_privilege('anon', trigger_function, 'EXECUTE')
       or has_function_privilege('authenticated', trigger_function, 'EXECUTE')
       or not has_function_privilege('service_role', trigger_function, 'EXECUTE') then
      raise exception 'Recovery trigger-function grants are unsafe for %', trigger_function;
    end if;
  end loop;
  if not coalesce((
    select proconfig @> array['search_path=pg_catalog']
    from pg_proc
    where oid=to_regprocedure('public.refresh_synced_at()')
  ), false) then
    raise exception 'Recovery refresh_synced_at search_path is unsafe';
  end if;

  if (select count(*) from public.live_catalogue_runs where source='myharvard' and status='active') <> 1 then
    raise exception 'Recovery data must contain exactly one active my.harvard run';
  end if;
  select * into active_run from public.live_catalogue_runs
  where source='myharvard' and status='active';
  select count(*), encode(
    extensions.digest(string_agg(source_offering_id, E'\n' order by source_offering_id), 'sha256'),
    'hex'
  ) into actual_rows, actual_digest
  from public.live_courses
  where sync_run_id=active_run.id and source='myharvard' and active;
  select coalesce(jsonb_object_agg(term, offering_count order by term), '{}'::jsonb)
    into actual_terms
  from (
    select term, count(*)::integer as offering_count from public.live_courses
    where sync_run_id=active_run.id and source='myharvard' and active group by term
  ) terms;
  if actual_rows <> active_run.offering_count
     or actual_digest is distinct from active_run.identity_sha256
     or actual_terms is distinct from active_run.term_counts then
    raise exception 'Recovery active my.harvard manifest does not match restored offerings';
  end if;

  select count(*) into active_ats_run_count
  from public.live_catalogue_runs where source='ats' and status='active';
  if active_ats_run_count > 1 then
    raise exception 'Recovery data contains multiple active ATS runs';
  end if;
  if active_ats_run_count = 1 then
    select * into active_ats_run from public.live_catalogue_runs
    where source='ats' and status='active';
    select count(*), encode(
      extensions.digest(string_agg(id, E'\n' order by id), 'sha256'),
      'hex'
    ) into actual_rows, actual_digest
    from public.live_courses
    where sync_run_id=active_ats_run.id and source='ats' and active and not is_hks;
    select coalesce(jsonb_object_agg(term, offering_count order by term), '{}'::jsonb)
      into actual_terms
    from (
      select term, count(*)::integer as offering_count from public.live_courses
      where sync_run_id=active_ats_run.id and source='ats' and active and not is_hks
      group by term
    ) terms;
    if actual_rows <> active_ats_run.offering_count
       or actual_digest is distinct from active_ats_run.identity_sha256
       or actual_terms is distinct from active_ats_run.term_counts
       or exists (
         select 1 from public.live_courses
         where source='ats' and not is_hks
           and (
             (sync_run_id=active_ats_run.id and not active)
             or (sync_run_id is distinct from active_ats_run.id and active)
           )
       ) then
      raise exception 'Recovery active ATS manifest or retained visibility is inconsistent';
    end if;
  elsif exists (
    select 1 from public.live_courses
    where source='ats' and sync_run_id is not null
  ) then
    raise exception 'Recovery legacy ATS state unexpectedly contains run ownership';
  end if;

  if not exists (
    select 1 from public.live_courses live
    join public.courses history using (course_code_base)
    join public.course_sections section using (course_code_base)
    where live.active and live.is_hks
  ) then
    raise exception 'Recovery data has no representative current/history/section link';
  end if;
  if (select marker from public.unrelated_recovery_sentinel where id=1) <> 'unchanged' then
    raise exception 'Recovery altered the unrelated shared-project sentinel';
  end if;
end
$$;
