\set ON_ERROR_STOP on

select table_name, payload from (
  select 1 as table_order, id::text as row_id, 'courses'::text as table_name, to_jsonb(row)::text as payload from public.courses as row
  union all
  select 2, id::text, 'course_sections', to_jsonb(row)::text from public.course_sections as row
  union all
  select 3, id::text, 'schedules', to_jsonb(row)::text from public.schedules as row
  union all
  select 4, id::text, 'live_catalogue_runs', to_jsonb(row)::text from public.live_catalogue_runs as row
  union all
  select 5, id::text, 'live_courses', to_jsonb(row)::text from public.live_courses as row
) as restored
order by table_order, row_id;
