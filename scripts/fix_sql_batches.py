"""Fix instructors type cast in all sql_batch_N.sql files."""
import os, glob

OLD = "  COALESCE(r -> 'instructors', '[]'::jsonb),"
NEW = "  ARRAY(SELECT jsonb_array_elements_text(COALESCE(r -> 'instructors', '[]'::jsonb)))::text[],"

scripts_dir = os.path.dirname(os.path.abspath(__file__))
files = sorted(glob.glob(os.path.join(scripts_dir, "sql_batch_*.sql")))

for f in files:
    with open(f, "r", encoding="utf-8") as fh:
        content = fh.read()
    if OLD in content:
        content = content.replace(OLD, NEW)
        with open(f, "w", encoding="utf-8") as fh:
            fh.write(content)
        print(f"Fixed: {os.path.basename(f)}")
    else:
        print(f"Already fixed or not found: {os.path.basename(f)}")

print("Done.")
