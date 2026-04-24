"""Generate SQL batch files for Supabase upsert of beta.my.harvard.edu data."""
import json

with open('scripts/beta_rows_compact.json') as f:
    items = json.load(f)

def make_sql(batch):
    vals = json.dumps(batch).replace("'", "''")
    return f"""INSERT INTO course_sections (id, course_code_base, course_code, term, harvard_id, section_type, title, credits, instructors, meetings, is_active, raw, fetched_at)
SELECT
  (r ->> 'id'),
  (r ->> 'course_code_base'),
  (r ->> 'course_code'),
  (r ->> 'term'),
  COALESCE(r ->> 'harvard_id', ''),
  COALESCE(r ->> 'section_type', 'LEC'),
  COALESCE(r ->> 'title', ''),
  (CASE WHEN r ->> 'credits' IS NOT NULL THEN (r ->> 'credits')::numeric ELSE NULL END),
  COALESCE(r -> 'instructors', '[]'::jsonb),
  COALESCE(r -> 'meetings', '[]'::jsonb),
  true,
  COALESCE(r -> 'raw', '{{}}'::jsonb),
  NOW()
FROM jsonb_array_elements('{vals}'::jsonb) AS r
ON CONFLICT (id) DO UPDATE SET
  meetings = EXCLUDED.meetings,
  raw = EXCLUDED.raw,
  fetched_at = EXCLUDED.fetched_at;"""

batch_size = 50
batches = [items[i:i+batch_size] for i in range(0, len(items), batch_size)]
for i, batch in enumerate(batches):
    sql = make_sql(batch)
    fname = f'scripts/sql_batch_{i+1}.sql'
    with open(fname, 'w', encoding='utf-8') as f:
        f.write(sql)
    print(f'Batch {i+1}: {len(batch)} rows, SQL length {len(sql):,}')

print(f'Done: {len(batches)} batches, {len(items)} total rows')
