-- Clean-room baseline for the five current Course Explorer production tables.
--
-- This file is intentionally allowlist-only. It does not dump or modify any
-- unrelated object from the shared Supabase project. The recovery workflow
-- applies the reviewed forward migrations after this legacy baseline.
\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'create role anon nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'create role authenticated nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'create role service_role nologin bypassrls';
  end if;
end
$$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.courses (
  id text primary key,
  course_code text,
  course_code_base text,
  concentration text,
  year integer,
  term text,
  is_average boolean default false,
  year_range text,
  n_terms integer,
  professor text,
  professor_display text,
  faculty_title text,
  faculty_category text,
  course_name text,
  description text,
  course_url text,
  is_stem boolean default false,
  stem_group text,
  stem_school text,
  is_core boolean default false,
  has_eval boolean default false,
  n_respondents integer,
  total_n_respondents integer,
  metrics_raw jsonb,
  metrics_pct jsonb,
  instructor_label text,
  workload_label text,
  has_bidding boolean default false,
  ever_bidding boolean default false,
  last_bid_price real,
  last_bid_acad text,
  last_bid_term text,
  last_bid_capacity integer,
  last_bid_n_bids real,
  bid_clearing_price real,
  bid_academic_year text,
  bid_capacity integer,
  bid_n_bids real,
  meeting_days text,
  time_start text,
  time_end text,
  location text
);

create index courses_concentration_idx on public.courses (concentration);
create index courses_has_eval_idx on public.courses (has_eval);
create index courses_is_average_idx on public.courses (is_average);
create index courses_professor_idx on public.courses (professor);
create index courses_year_idx on public.courses (year);

create table public.course_sections (
  id text primary key,
  course_code_base text not null,
  course_code text,
  term text not null,
  harvard_id text,
  section_type text default 'LEC',
  title text,
  credits real,
  instructors text[],
  meetings jsonb default '[]'::jsonb,
  is_active boolean default true,
  raw jsonb,
  fetched_at timestamptz default now()
);

create index course_sections_course_code_base_idx on public.course_sections (course_code_base);
create index course_sections_course_code_base_term_idx
  on public.course_sections (course_code_base, term);
create index course_sections_is_active_idx on public.course_sections (is_active);
create index course_sections_term_idx on public.course_sections (term);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  plan_name text not null,
  plan_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index schedules_user_id_idx on public.schedules (user_id);
create unique index schedules_user_plan_idx on public.schedules (user_id, plan_name);

create table public.live_courses (
  id text primary key,
  course_code text,
  course_code_base text,
  title text,
  term text,
  credits real,
  instructors jsonb default '[]'::jsonb,
  description text,
  location text,
  meeting_days text,
  time_start text,
  time_end text,
  school text,
  is_hks boolean default false,
  synced_at timestamptz default now(),
  session_code text default '',
  session_description text default '',
  cross_reg_eligible text default ''
);

create index live_courses_course_code_base_idx on public.live_courses (course_code_base);
create index live_courses_is_hks_idx on public.live_courses (is_hks);
create index live_courses_meeting_days_idx on public.live_courses (meeting_days);
create index live_courses_school_idx on public.live_courses (school);
create index live_courses_term_idx on public.live_courses (term);

create or replace function public.refresh_synced_at()
returns trigger
language plpgsql
as $$
begin
  new.synced_at = now();
  return new;
end;
$$;

create trigger live_courses_refresh_synced_at
before update on public.live_courses
for each row execute function public.refresh_synced_at();

alter table public.courses enable row level security;
alter table public.course_sections enable row level security;
alter table public.schedules enable row level security;
alter table public.live_courses enable row level security;

create policy "Public read" on public.courses for select to public using (true);
create policy "Public read" on public.course_sections for select to public using (true);
create policy "Public read" on public.live_courses for select to public using (true);

grant select, insert, update, delete, truncate, references, trigger
  on public.courses, public.course_sections, public.live_courses
  to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger
  on public.schedules to anon, authenticated;

grant select, insert, update, delete, truncate, references, trigger
  on public.courses, public.course_sections, public.live_courses, public.schedules
  to service_role;
