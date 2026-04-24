"""Generate mini SQL batch files (20 rows each) from beta_rows_compact.json.
Output: scripts/mini_batch_01.sql ... mini_batch_NN.sql
"""
import json, os, math

BATCH_SIZE = 20
scripts_dir = os.path.dirname(os.path.abspath(__file__))

src = os.path.join(scripts_dir, "beta_rows_compact.json")
with open(src, "r", encoding="utf-8") as f:
    rows = json.load(f)

print(f"Loaded {len(rows)} rows")

HEADER = """INSERT INTO course_sections (id, course_code_base, course_code, term, harvard_id, section_type, title, credits, instructors, meetings, is_active, raw, fetched_at)
SELECT
  (r ->> 'id'),
  (r ->> 'course_code_base'),
  (r ->> 'course_code'),
  (r ->> 'term'),
  COALESCE(r ->> 'harvard_id', ''),
  COALESCE(r ->> 'section_type', 'LEC'),
  COALESCE(r ->> 'title', ''),
  (CASE WHEN r ->> 'credits' IS NOT NULL THEN (r ->> 'credits')::numeric ELSE NULL END),
  ARRAY(SELECT jsonb_array_elements_text(COALESCE(r -> 'instructors', '[]'::jsonb)))::text[],
  COALESCE(r -> 'meetings', '[]'::jsonb),
  true,
  COALESCE(r -> 'raw', '{}'::jsonb),
  NOW()
FROM jsonb_array_elements("""

FOOTER = """::jsonb) AS r
ON CONFLICT (id) DO UPDATE SET
  meetings = EXCLUDED.meetings,
  raw = EXCLUDED.raw,
  fetched_at = EXCLUDED.fetched_at;"""

n_batches = math.ceil(len(rows) / BATCH_SIZE)
for i in range(n_batches):
    batch = rows[i*BATCH_SIZE:(i+1)*BATCH_SIZE]
    # Encode the JSON array — use single quotes in SQL, escape any single quotes in values
    json_str = json.dumps(batch, ensure_ascii=False).replace("'", "''")
    sql = HEADER + f"'{json_str}'" + FOOTER
    fname = os.path.join(scripts_dir, f"mini_batch_{i+1:02d}.sql")
    with open(fname, "w", encoding="utf-8") as f:
        f.write(sql)
    size = len(sql)
    print(f"  mini_batch_{i+1:02d}.sql — {len(batch)} rows, {size:,} chars")

print(f"\nGenerated {n_batches} mini-batch files.")
