-- Fail closed unless the course_sections grant hardening produced the exact
-- supported effective privilege boundary. This migration changes no object;
-- it also catches privileges inherited through PUBLIC or another role.

do $$
declare
  browser_role name;
  write_privilege text;
begin
  if to_regclass('public.course_sections') is null then
    raise exception 'Section grant postcondition failed: public.course_sections is missing';
  end if;
  if not (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'course_sections'
  ) then
    raise exception 'Section grant postcondition failed: RLS is not enabled';
  end if;
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'course_sections'
      and policyname = 'Public read'
      and permissive = 'PERMISSIVE'
      and roles = array['public']::name[]
      and cmd = 'SELECT'
      and coalesce(qual, '') = 'true'
      and with_check is null
  ) or (
    select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'course_sections'
  ) <> 1 then
    raise exception 'Section grant postcondition failed: public SELECT policy drifted';
  end if;

  foreach browser_role in array array['anon'::name, 'authenticated'::name]
  loop
    if not has_table_privilege(browser_role, 'public.course_sections', 'SELECT') then
      raise exception 'Section grant postcondition failed: % cannot SELECT', browser_role;
    end if;
    foreach write_privilege in array array[
      'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    loop
      if has_table_privilege(browser_role, 'public.course_sections', write_privilege) then
        raise exception 'Section grant postcondition failed: % still has %',
          browser_role, write_privilege;
      end if;
    end loop;
  end loop;

  foreach write_privilege in array array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ]
  loop
    if not has_table_privilege('service_role', 'public.course_sections', write_privilege) then
      raise exception 'Section grant postcondition failed: service_role lost %',
        write_privilege;
    end if;
  end loop;
end
$$;
