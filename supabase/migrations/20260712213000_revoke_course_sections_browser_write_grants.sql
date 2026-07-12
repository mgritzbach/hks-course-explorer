-- Defense-in-depth for the Schedule Builder's read-only section catalogue.
--
-- RLS and the existing public SELECT policy already provide the supported
-- browser read path. Remove only unsupported browser write-oriented table
-- privileges. The service role, policy, schema, and all rows remain unchanged.

do $$
declare
  policy_count integer;
  select_policy_count integer;
begin
  if to_regclass('public.course_sections') is null then
    raise exception 'Refusing section grant hardening: public.course_sections is missing';
  end if;
  if not (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'course_sections'
  ) then
    raise exception 'Refusing section grant hardening: public.course_sections RLS is not enabled';
  end if;

  select count(*), count(*) filter (where cmd = 'SELECT')
  into policy_count, select_policy_count
  from pg_policies
  where schemaname = 'public' and tablename = 'course_sections';

  if policy_count <> 1 or select_policy_count <> 1 then
    raise exception 'Refusing section grant hardening: expected exactly one SELECT policy';
  end if;
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'course_sections'
      and cmd = 'SELECT'
      and roles = array['public']::name[]
      and coalesce(qual, '') = 'true'
      and with_check is null
  ) then
    raise exception 'Refusing section grant hardening: public SELECT policy drifted';
  end if;

  revoke insert, update, delete, truncate, references, trigger
    on table public.course_sections from anon, authenticated;
  grant select on table public.course_sections to anon, authenticated;
end
$$;
