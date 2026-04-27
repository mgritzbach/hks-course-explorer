# HKS Course Explorer

## Day and Time Filter

Filter courses by meeting day using `Mon`, `Tue`, `Wed`, `Thu`, and `Fri`, and by time of day using `Morning`, `Afternoon`, and `Evening`.

Courses without schedule data are shown by default. Enable `Hide courses without schedule info` to restrict results to courses with known schedule metadata.

Real schedule data can be populated by running:

- `python scripts/scrape_meeting_times.py`
- `python scripts/apply_meeting_times.py`

Mock schedule data for local testing can be seeded with:

- `python scripts/seed_mock_schedule.py`
