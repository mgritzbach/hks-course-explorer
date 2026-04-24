"""
fetch_to_sql.py
───────────────
Fetches HKS course sections from the Harvard ATS API and writes
SQL UPSERT statements to scripts/sections_import.sql.
No Supabase credentials needed — import the SQL via Supabase MCP.

Usage:
    HARVARD_API_KEY=<key> python scripts/fetch_to_sql.py
"""
import os, sys, time, json, re
from datetime import datetime, timezone

HARVARD_API_KEY = os.environ.get("HARVARD_API_KEY", "")
if not HARVARD_API_KEY:
    sys.exit("ERROR: set HARVARD_API_KEY env var")

UPSTREAM = "https://go.apis.huit.harvard.edu/ats/course/v2/search"
HKS_SUBJECTS = ["API", "DPI", "IGA", "MPA", "SUP", "BGP", "DEV", "MLD", "HKS"]

DAY_ABBREV = {
    "monday":"MON","tuesday":"TUE","wednesday":"WED","thursday":"THU",
    "friday":"FRI","saturday":"SAT","sunday":"SUN",
    "mon":"MON","tue":"TUE","wed":"WED","thu":"THU","fri":"FRI","sat":"SAT","sun":"SUN",
}

def norm_time(t):
    if not t: return None
    t = str(t).strip().lower()
    m = re.match(r'^(\d{1,2}):(\d{2})\s*(am|pm)?$', t)
    if not m: return t
    h, mn, ampm = int(m.group(1)), int(m.group(2)), m.group(3)
    if ampm == 'am' and h == 12: h = 0
    if ampm == 'pm' and h != 12: h += 12
    return f"{h:02d}:{mn:02d}"

def parse_meetings(raw):
    if not raw or raw == "TBA": return []
    items = raw if isinstance(raw, list) else [raw]
    result = []
    for m in items:
        if not isinstance(m, dict): continue
        days  = m.get("daysOfWeek") or []
        start = norm_time(m.get("startTime") or "")
        end   = norm_time(m.get("endTime") or "")
        loc   = (m.get("location") or "").strip()
        for day_raw in days:
            day = DAY_ABBREV.get(str(day_raw).lower())
            if day and start:
                result.append({"day": day, "start": start, "end": end, "location": loc})
    return result

def build_code_base(course_number):
    if not course_number: return ""
    parts = str(course_number).strip().split()
    return f"{parts[0]}-{parts[1]}".upper() if len(parts) >= 2 else parts[0].upper()

def fetch_subject(subject):
    import requests
    headers = {"x-api-key": HARVARD_API_KEY, "Accept": "application/json", "User-Agent": "HKS-Course-Explorer/2.0"}
    params  = {"catalogSchool": "HKS", "subject": subject, "limit": 50}
    try:
        resp = requests.get(UPSTREAM, headers=headers, params=params, timeout=30)
        if resp.status_code == 404: return []
        resp.raise_for_status()
        data = resp.json()
        return data.get("results") or data.get("courses") or (data if isinstance(data, list) else [])
    except Exception as e:
        print(f"  Warning [{subject}]: {e}", file=sys.stderr)
        return []

def courses_to_rows(raw_courses):
    rows, seen = [], set()
    fetched_at = datetime.now(timezone.utc).isoformat()
    for c in raw_courses:
        course_number = str(c.get("courseNumber") or "").strip()
        code_base = build_code_base(course_number)
        if not code_base: continue
        term_desc = str(c.get("termDescription") or "")
        term = term_desc.replace(" ", "") if term_desc else str(c.get("term") or "")
        row_id = f"{code_base}__{term}"
        meetings = parse_meetings(c.get("meetings"))
        if row_id in seen:
            for row in rows:
                if row["id"] == row_id:
                    existing = {(m["day"], m["start"]) for m in row["meetings"]}
                    for m in meetings:
                        if (m["day"], m["start"]) not in existing:
                            row["meetings"].append(m)
            continue
        seen.add(row_id)
        instructors = [str(i.get("instructorName") or "").strip()
                       for i in (c.get("publishedInstructors") or []) if i.get("instructorName")]
        credits = c.get("classMinUnits") or c.get("classMaxUnits")
        rows.append({
            "id": row_id,
            "course_code_base": code_base,
            "course_code": course_number.replace(" ", "-"),
            "term": term,
            "harvard_id": str(c.get("courseID") or c.get("classNumber") or ""),
            "section_type": "LEC",
            "title": str(c.get("courseTitle") or "").strip(),
            "credits": float(credits) if credits else None,
            "instructors": instructors,
            "meetings": meetings,
            "is_active": True,
            "fetched_at": fetched_at,
        })
    return rows

def sql_literal(v):
    if v is None: return "NULL"
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int, float)): return str(v)
    if isinstance(v, (list, dict)): return "'" + json.dumps(v).replace("'", "''") + "'"
    return "'" + str(v).replace("'", "''") + "'"

def rows_to_sql(rows):
    lines = []
    for r in rows:
        instructors_sql = "ARRAY[" + ",".join(sql_literal(i) for i in r["instructors"]) + "]::text[]" if r["instructors"] else "ARRAY[]::text[]"
        meetings_sql = "'" + json.dumps(r["meetings"]).replace("'", "''") + "'::jsonb"
        raw_sql = "'{}'::jsonb"
        lines.append(
            f"INSERT INTO course_sections (id,course_code_base,course_code,term,harvard_id,section_type,title,credits,instructors,meetings,is_active,raw,fetched_at) "
            f"VALUES ({sql_literal(r['id'])},{sql_literal(r['course_code_base'])},{sql_literal(r['course_code'])},{sql_literal(r['term'])},"
            f"{sql_literal(r['harvard_id'])},{sql_literal(r['section_type'])},{sql_literal(r['title'])},"
            f"{'NULL' if r['credits'] is None else r['credits']},{instructors_sql},{meetings_sql},true,{raw_sql},{sql_literal(r['fetched_at'])}) "
            f"ON CONFLICT (id) DO UPDATE SET meetings=EXCLUDED.meetings,title=EXCLUDED.title,instructors=EXCLUDED.instructors,credits=EXCLUDED.credits,fetched_at=EXCLUDED.fetched_at;"
        )
    return "\n".join(lines)

def main():
    import requests  # check available
    all_rows, seen = [], set()
    print(f"Fetching {len(HKS_SUBJECTS)} subjects from Harvard ATS API...", file=sys.stderr)
    for subject in HKS_SUBJECTS:
        print(f"  {subject}...", end="", flush=True, file=sys.stderr)
        raw = fetch_subject(subject)
        print(f" {len(raw)} courses", file=sys.stderr)
        for r in courses_to_rows(raw):
            if r["id"] not in seen:
                seen.add(r["id"])
                all_rows.append(r)
        time.sleep(0.3)
    with_times = sum(1 for r in all_rows if r["meetings"])
    print(f"\nTotal: {len(all_rows)} rows, {with_times} with meeting times", file=sys.stderr)
    out_path = os.path.join(os.path.dirname(__file__), "sections_import.sql")
    sql = rows_to_sql(all_rows)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(sql)
    print(f"SQL written to {out_path} ({len(all_rows)} INSERT statements)", file=sys.stderr)

if __name__ == "__main__":
    main()
