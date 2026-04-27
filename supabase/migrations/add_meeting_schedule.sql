ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS meeting_days text[] DEFAULT NULL;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS meeting_time text DEFAULT NULL;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS meeting_time_end text DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_courses_meeting_days ON public.courses USING GIN (meeting_days);
