-- Preserve every published meeting interval in the current catalogue. The
-- legacy flat columns remain for single-interval clients, while `meetings`
-- is authoritative for courses whose weekdays have different time ranges.

alter table public.live_courses
  add column if not exists meetings jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.live_courses'::regclass
      and conname = 'live_courses_meetings_is_array'
  ) then
    alter table public.live_courses
      add constraint live_courses_meetings_is_array
      check (pg_catalog.jsonb_typeof(meetings) = 'array') not valid;
  end if;
end;
$$;

-- Convert existing complete flat schedules into the lossless representation.
update public.live_courses as course
set meetings = (
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'day', pg_catalog.upper(day.value),
        'start', course.time_start,
        'end', course.time_end,
        'location', coalesce(course.location, '')
      ) order by day.ordinality
    ),
    '[]'::jsonb
  )
  from pg_catalog.regexp_split_to_table(course.meeting_days, E'[/,\\s]+')
    with ordinality as day(value, ordinality)
  where nullif(pg_catalog.btrim(day.value), '') is not null
)
where course.meetings = '[]'::jsonb
  and nullif(pg_catalog.btrim(course.meeting_days), '') is not null
  and nullif(pg_catalog.btrim(course.time_start), '') is not null
  and nullif(pg_catalog.btrim(course.time_end), '') is not null;

alter table public.live_courses
  validate constraint live_courses_meetings_is_array;

-- Retain the battle-tested HKS staging implementation and wrap it so meeting
-- persistence participates in the exact same transaction and advisory lock.
alter function public.stage_myharvard_hks_offerings(uuid, jsonb)
  rename to stage_myharvard_hks_offerings_without_meetings;

create function public.stage_myharvard_hks_offerings(
  p_run_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  staged_rows integer;
  meeting_rows integer;
begin
  if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array'
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(p_rows) as item(value)
       where pg_catalog.jsonb_typeof(item.value -> 'meetings') is distinct from 'array'
          or exists (
            select 1
            from pg_catalog.jsonb_array_elements(item.value -> 'meetings') as meeting(value)
            where pg_catalog.jsonb_typeof(meeting.value) is distinct from 'object'
               or nullif(pg_catalog.btrim(meeting.value ->> 'day'), '') is null
               or meeting.value ->> 'day' not in ('SUN','MON','TUE','WED','THU','FRI','SAT')
               or nullif(pg_catalog.btrim(meeting.value ->> 'start'), '') is null
               or meeting.value ->> 'start' !~ '^[0-2][0-9]:[0-5][0-9]$'
               or nullif(pg_catalog.btrim(meeting.value ->> 'end'), '') is null
               or meeting.value ->> 'end' !~ '^[0-2][0-9]:[0-5][0-9]$'
          )
     ) then
    raise exception 'HKS meeting payload is missing or malformed';
  end if;

  staged_rows := public.stage_myharvard_hks_offerings_without_meetings(p_run_id, p_rows);

  update public.live_courses as course
  set meetings = item.value -> 'meetings'
  from pg_catalog.jsonb_array_elements(p_rows) as item(value)
  where course.sync_run_id = p_run_id
    and course.source = 'myharvard'
    and course.active is false
    and course.source_offering_id = item.value ->> 'id';

  get diagnostics meeting_rows = row_count;
  if meeting_rows <> staged_rows then
    raise exception 'Stored meeting lists for % HKS offerings; expected %',
      meeting_rows, staged_rows;
  end if;
  return staged_rows;
end;
$$;

revoke all on function public.stage_myharvard_hks_offerings_without_meetings(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.stage_myharvard_hks_offerings(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.stage_myharvard_hks_offerings(uuid, jsonb)
  to service_role;

-- Apply the same transactional wrapper to the general ATS catalogue so
-- cross-registration courses also retain all intervals returned by the API.
alter function public.sync_live_courses_atomically(jsonb)
  rename to sync_live_courses_atomically_without_meetings;

create function public.sync_live_courses_atomically(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  synced_rows integer;
  meeting_rows integer;
begin
  if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array'
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(p_rows) as item(value)
       where pg_catalog.jsonb_typeof(item.value -> 'meetings') is distinct from 'array'
          or exists (
            select 1
            from pg_catalog.jsonb_array_elements(item.value -> 'meetings') as meeting(value)
            where pg_catalog.jsonb_typeof(meeting.value) is distinct from 'object'
               or nullif(pg_catalog.btrim(meeting.value ->> 'day'), '') is null
               or meeting.value ->> 'day' not in ('SUN','MON','TUE','WED','THU','FRI','SAT')
               or nullif(pg_catalog.btrim(meeting.value ->> 'start'), '') is null
               or meeting.value ->> 'start' !~ '^[0-2][0-9]:[0-5][0-9]$'
               or nullif(pg_catalog.btrim(meeting.value ->> 'end'), '') is null
               or meeting.value ->> 'end' !~ '^[0-2][0-9]:[0-5][0-9]$'
          )
     ) then
    raise exception 'ATS meeting payload is missing or malformed';
  end if;

  synced_rows := public.sync_live_courses_atomically_without_meetings(p_rows);

  update public.live_courses as course
  set meetings = item.value -> 'meetings'
  from pg_catalog.jsonb_array_elements(p_rows) as item(value)
  where course.id = item.value ->> 'id'
    and course.source = 'ats'
    and course.is_hks is false
    and course.active is true;

  get diagnostics meeting_rows = row_count;
  if meeting_rows <> synced_rows then
    raise exception 'Stored meeting lists for % ATS offerings; expected %',
      meeting_rows, synced_rows;
  end if;
  return synced_rows;
end;
$$;

revoke all on function public.sync_live_courses_atomically_without_meetings(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.sync_live_courses_atomically(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_live_courses_atomically(jsonb)
  to service_role;

notify pgrst, 'reload schema';