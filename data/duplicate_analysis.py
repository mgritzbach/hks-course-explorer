import csv
import difflib
from collections import defaultdict


CSV_PATH = r"C:/Users/micgr/OneDrive/Desktop/Antigravity/Data_Science_Claude/hks-course-explorer/data/canonical_courses_enriched.csv"
REPORT_PATH = r"C:/Users/micgr/OneDrive/Desktop/Antigravity/Data_Science_Claude/hks-course-explorer/data/duplicate_report.txt"


def text(value):
    return (value or "").strip()


def normalize_name(value):
    chars = []
    for ch in text(value).lower():
        if ch.isalnum() or ch.isspace():
            chars.append(ch)
        else:
            chars.append(" ")
    return " ".join("".join(chars).split())


def is_average(row):
    return text(row.get("is_average")).lower() in {"1", "true", "yes", "y", "average"}


def number(value):
    value = text(value)
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def ratio(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio()


def years_for(rows):
    return sorted({text(row.get("year")) for row in rows if text(row.get("year"))})


def fmt_years(years):
    return ", ".join(years) if years else "(none)"


def fmt_score(score):
    return f"{score:.3f}"


def load_rows():
    with open(CSV_PATH, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        rows = list(reader)
    return rows, reader.fieldnames or []


def check_professor_near_duplicates(rows):
    by_prof = defaultdict(list)
    course_years_by_prof = defaultdict(set)
    for row in rows:
        prof = text(row.get("professor"))
        if not prof:
            continue
        by_prof[prof].append(row)
        base = text(row.get("course_code_base"))
        year = text(row.get("year"))
        if base and year:
            course_years_by_prof[prof].add((base, year))

    professors = sorted(by_prof)
    suspects = []
    for i, prof_a in enumerate(professors):
        norm_a = normalize_name(prof_a)
        if not norm_a:
            continue
        for prof_b in professors[i + 1:]:
            norm_b = normalize_name(prof_b)
            if not norm_b:
                continue
            score = ratio(norm_a, norm_b)
            if score >= 0.85:
                shared = sorted(course_years_by_prof[prof_a] & course_years_by_prof[prof_b])
                suspects.append({
                    "prof_a": prof_a,
                    "prof_b": prof_b,
                    "score": score,
                    "count_a": len(by_prof[prof_a]),
                    "count_b": len(by_prof[prof_b]),
                    "shared": shared,
                })

    suspects.sort(key=lambda x: (x["score"], len(x["shared"]), x["count_a"] + x["count_b"]), reverse=True)
    return suspects


def check_course_code_name_cross_duplicates(rows):
    by_code_norm = defaultdict(list)
    for row in rows:
        code = text(row.get("course_code_base"))
        name = text(row.get("course_name"))
        norm = normalize_name(name)
        if code and norm:
            by_code_norm[(code, norm)].append(row)

    name_records = []
    for (code, norm), rec_rows in by_code_norm.items():
        name_counts = defaultdict(int)
        for row in rec_rows:
            name_counts[text(row.get("course_name"))] += 1
        display_name = sorted(name_counts.items(), key=lambda x: (x[1], x[0]), reverse=True)[0][0]
        name_records.append({
            "code": code,
            "norm": norm,
            "name": display_name,
            "years": years_for(rec_rows),
            "rows": len(rec_rows),
        })

    suspect_by_key = {}
    for i, rec_a in enumerate(name_records):
        for rec_b in name_records[i + 1:]:
            if rec_a["code"] == rec_b["code"]:
                continue
            if rec_a["norm"] == rec_b["norm"]:
                score = 1.0
                kind = "exact normalized name"
            else:
                score = ratio(rec_a["norm"], rec_b["norm"])
                if score < 0.88:
                    continue
                kind = "similar normalized name"

            left, right = rec_a, rec_b
            if (right["code"], right["name"]) < (left["code"], left["name"]):
                left, right = right, left
            key = (left["code"], left["name"], right["code"], right["name"])
            current = suspect_by_key.get(key)
            if current is None or score > current["score"]:
                suspect_by_key[key] = {
                    "code_a": left["code"],
                    "name_a": left["name"],
                    "years_a": left["years"],
                    "rows_a": left["rows"],
                    "code_b": right["code"],
                    "name_b": right["name"],
                    "years_b": right["years"],
                    "rows_b": right["rows"],
                    "score": score,
                    "kind": kind,
                }

    suspects = list(suspect_by_key.values())
    suspects.sort(key=lambda x: (x["score"], x["rows_a"] + x["rows_b"]), reverse=True)
    return suspects


def check_exact_row_duplicates(rows):
    groups = defaultdict(list)
    for index, row in enumerate(rows, start=1):
        if is_average(row):
            continue
        key = (
            text(row.get("course_code_base")),
            text(row.get("year")),
            text(row.get("term")),
            text(row.get("professor")),
        )
        if all(key):
            groups[key].append((index, row))

    suspects = []
    for key, members in groups.items():
        if len(members) > 1:
            suspects.append({"key": key, "members": members})
    suspects.sort(key=lambda x: len(x["members"]), reverse=True)
    return suspects


def check_cotaught_duplicate_suspects(rows):
    groups = defaultdict(list)
    for index, row in enumerate(rows, start=1):
        key = (
            text(row.get("course_code_base")),
            text(row.get("year")),
            text(row.get("term")),
        )
        if all(key):
            groups[key].append((index, row))

    suspects = []
    metrics = ["Instructor_Rating", "Course_Rating", "Workload"]
    for key, members in groups.items():
        professors = {text(row.get("professor")) for _, row in members if text(row.get("professor"))}
        if len(professors) < 3:
            continue
        metric_ranges = {}
        all_within = True
        for metric in metrics:
            values = [number(row.get(metric)) for _, row in members]
            values = [value for value in values if value is not None]
            if len(values) < 2:
                metric_ranges[metric] = None
                continue
            span = max(values) - min(values)
            metric_ranges[metric] = span
            if span > 3:
                all_within = False
                break
        if all_within:
            suspects.append({
                "key": key,
                "members": members,
                "professors": sorted(professors),
                "metric_ranges": metric_ranges,
            })

    suspects.sort(key=lambda x: (len(x["professors"]), len(x["members"])), reverse=True)
    return suspects


def check_per_professor_course_duplicates(rows):
    by_prof_code_norm = defaultdict(lambda: defaultdict(list))
    for row in rows:
        prof = text(row.get("professor"))
        code = text(row.get("course_code_base"))
        name = text(row.get("course_name"))
        norm = normalize_name(name)
        if prof and code and norm:
            by_prof_code_norm[prof][(code, norm)].append(row)

    suspects = []
    seen = set()
    for prof, course_map in by_prof_code_norm.items():
        records = []
        for (code, norm), rec_rows in course_map.items():
            name_counts = defaultdict(int)
            for row in rec_rows:
                name_counts[text(row.get("course_name"))] += 1
            display_name = sorted(name_counts.items(), key=lambda x: (x[1], x[0]), reverse=True)[0][0]
            records.append({
                "prof": prof,
                "code": code,
                "norm": norm,
                "name": display_name,
                "years": years_for(rec_rows),
                "rows": len(rec_rows),
            })
        for i, rec_a in enumerate(records):
            for rec_b in records[i + 1:]:
                if rec_a["code"] == rec_b["code"]:
                    continue
                score = ratio(rec_a["norm"], rec_b["norm"])
                if score < 0.90:
                    continue
                left, right = rec_a, rec_b
                if (right["code"], right["name"]) < (left["code"], left["name"]):
                    left, right = right, left
                key = (prof, left["code"], left["name"], right["code"], right["name"])
                if key in seen:
                    continue
                seen.add(key)
                suspects.append({
                    "prof": prof,
                    "code_a": left["code"],
                    "name_a": left["name"],
                    "years_a": left["years"],
                    "code_b": right["code"],
                    "name_b": right["name"],
                    "years_b": right["years"],
                    "score": score,
                    "rows": left["rows"] + right["rows"],
                })

    suspects.sort(key=lambda x: (x["score"], x["rows"]), reverse=True)
    return suspects


def add_section(lines, title, suspects, formatter, top=None):
    lines.append("")
    lines.append(title)
    lines.append("=" * len(title))
    lines.append(f"Total suspects: {len(suspects)}")
    shown = suspects if top is None else suspects[:top]
    if not shown:
        lines.append("No suspects found.")
        return
    for i, suspect in enumerate(shown, start=1):
        lines.extend(formatter(i, suspect))


def format_prof_suspect(i, s):
    shared = "; ".join(f"{code} {year}" for code, year in s["shared"]) if s["shared"] else "none"
    return [
        f"{i}. {s['prof_a']}  <->  {s['prof_b']}",
        f"   similarity={fmt_score(s['score'])}; row_counts={s['count_a']} vs {s['count_b']}; shared_courses={shared}",
    ]


def format_course_conflict(i, s):
    return [
        f"{i}. {s['code_a']}  <->  {s['code_b']} ({s['kind']})",
        f"   similarity={fmt_score(s['score'])}",
        f"   {s['code_a']}: {s['name_a']} | years={fmt_years(s['years_a'])}",
        f"   {s['code_b']}: {s['name_b']} | years={fmt_years(s['years_b'])}",
    ]


def format_row_dupe(i, s):
    base, year, term, prof = s["key"]
    lines = [f"{i}. key=(course_code_base={base}, year={year}, term={term}, professor={prof}); rows={len(s['members'])}"]
    for rownum, row in s["members"]:
        lines.append(
            "   "
            f"row={rownum}; course_code={text(row.get('course_code'))}; "
            f"course_name={text(row.get('course_name'))}; "
            f"n_respondents={text(row.get('n_respondents'))}; "
            f"Instructor_Rating={text(row.get('Instructor_Rating'))}; "
            f"Course_Rating={text(row.get('Course_Rating'))}; "
            f"Workload={text(row.get('Workload'))}; "
            f"is_average={text(row.get('is_average'))}"
        )
    return lines


def format_cotaught(i, s):
    base, year, term = s["key"]
    ranges = ", ".join(
        f"{metric}={'n/a' if value is None else fmt_score(value)}"
        for metric, value in s["metric_ranges"].items()
    )
    lines = [
        f"{i}. key=(course_code_base={base}, year={year}, term={term}); professors={len(s['professors'])}; rows={len(s['members'])}",
        f"   metric_ranges={ranges}",
    ]
    for rownum, row in s["members"]:
        lines.append(
            "   "
            f"row={rownum}; professor={text(row.get('professor'))}; "
            f"course_code={text(row.get('course_code'))}; "
            f"course_name={text(row.get('course_name'))}; "
            f"Instructor_Rating={text(row.get('Instructor_Rating'))}; "
            f"Course_Rating={text(row.get('Course_Rating'))}; "
            f"Workload={text(row.get('Workload'))}; "
            f"is_average={text(row.get('is_average'))}"
        )
    return lines


def format_per_prof(i, s):
    return [
        f"{i}. {s['prof']}: {s['code_a']}  <->  {s['code_b']}",
        f"   similarity={fmt_score(s['score'])}",
        f"   {s['code_a']}: {s['name_a']} | years={fmt_years(s['years_a'])}",
        f"   {s['code_b']}: {s['name_b']} | years={fmt_years(s['years_b'])}",
    ]


def build_report(rows, fields, results, top=None):
    prof_suspects, course_conflicts, row_dupes, cotaught, per_prof = results
    lines = []
    lines.append("HKS Course Duplicate Detection Report")
    lines.append("=====================================")
    lines.append(f"Dataset: {CSV_PATH}")
    lines.append(f"Rows loaded: {len(rows)}")
    lines.append(f"Columns loaded: {len(fields)}")
    lines.append(f"Display limit per section: {'all suspects' if top is None else top}")

    add_section(lines, "CHECK 1 - Professor name near-duplicates", prof_suspects, format_prof_suspect, top)
    add_section(lines, "CHECK 2 - Course code/name cross-duplicates", course_conflicts, format_course_conflict, top)
    add_section(lines, "CHECK 3 - Exact row duplicates", row_dupes, format_row_dupe, top)
    add_section(lines, "CHECK 4 - Co-taught duplicate suspects", cotaught, format_cotaught, top)
    add_section(lines, "CHECK 5 - Per-professor renumbered/renamed course duplicates", per_prof, format_per_prof, top)

    lines.append("")
    lines.append("Summary Table")
    lines.append("=============")
    lines.append(f"{'Category':55} Count")
    lines.append(f"{'-' * 55} -----")
    lines.append(f"{'Professor pairs':55} {len(prof_suspects)}")
    lines.append(f"{'Course name conflicts':55} {len(course_conflicts)}")
    lines.append(f"{'Row duplicate groups':55} {len(row_dupes)}")
    lines.append(f"{'Co-taught suspects':55} {len(cotaught)}")
    lines.append(f"{'Per-professor course duplicates':55} {len(per_prof)}")
    return "\n".join(lines) + "\n"


def main():
    rows, fields = load_rows()
    results = (
        check_professor_near_duplicates(rows),
        check_course_code_name_cross_duplicates(rows),
        check_exact_row_duplicates(rows),
        check_cotaught_duplicate_suspects(rows),
        check_per_professor_course_duplicates(rows),
    )
    full_report = build_report(rows, fields, results, top=None)
    with open(REPORT_PATH, "w", encoding="utf-8", newline="") as f:
        f.write(full_report)
    print(build_report(rows, fields, results, top=30), end="")
    print(f"Full report written to: {REPORT_PATH}")


if __name__ == "__main__":
    main()
