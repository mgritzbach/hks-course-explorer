import csv
import json
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE_CSV = ROOT / "data" / "canonical_courses_enriched.csv"
OUTPUT_JSON = ROOT / "public" / "courses.json"

RAW_METRICS = [
    "Instructor_Rating",
    "Course_Rating",
    "Workload",
    "Assignments",
    "Availability",
    "Discussions",
    "Diverse Perspectives",
    "Feedback",
    "Discussion Diversity",
    "Rigor",
    "Readings",
    "Insights",
]


def parse_bool(value):
    if value is None:
        return False
    return str(value).strip().lower() in {"true", "1", "yes", "y"}


def parse_float(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_int(value):
    number = parse_float(value)
    if number is None:
        return None
    return int(round(number))


def clean_text(value):
    if value is None:
        return ""
    return str(value).strip()


def nullable_text(value):
    text = clean_text(value)
    return text or None


def parse_year(value):
    number = parse_float(value)
    if number is None:
        return None
    return int(number)


def concentration_from_code(code):
    text = clean_text(code)
    if not text:
        return None
    return text.split("-", 1)[0]


def professor_display(name):
    text = clean_text(name)
    if not text:
        return ""
    if "," in text:
        last, first = [part.strip() for part in text.split(",", 1)]
        return f"{first} {last}".strip()
    return text


def instructor_label(score):
    if score is None:
        return "No Data"
    if score >= 4.8:
        return "Outstanding"
    if score >= 4.7:
        return "Excellent"
    if score >= 4.4:
        return "Good"
    if score >= 4.1:
        return "Average"
    return "Poor"


def workload_label(score):
    if score is None:
        return "No Data"
    if score < 2.9:
        return "Very Light"
    if score < 3.3:
        return "Light"
    if score < 3.75:
        return "Moderate"
    if score < 4.1:
        return "Heavy"
    return "Very Heavy"


def bid_sort_key(row):
    academic_year = clean_text(row.get("bid_academic_year"))
    first_year = 0
    if academic_year:
        try:
            first_year = int(academic_year.split("-", 1)[0])
        except ValueError:
            first_year = 0
    year = parse_year(row.get("year")) or 0
    term_order = {"January": 1, "Spring": 2, "Fall": 3, "Average": 0}
    term = clean_text(row.get("term"))
    return (first_year, year, term_order.get(term, -1))


def meta_from_courses(courses):
    concentrations = sorted({c["concentration"] for c in courses if c.get("concentration")})
    years = sorted({c["year"] for c in courses if c.get("year") is not None})
    terms = []
    for term in ["Fall", "Spring", "January", "Average"]:
        if any(course.get("term") == term for course in courses):
            terms.append(term)
    default_year = max((year for year in years if year and year > 0), default=max(years or [0]))
    return {
        "concentrations": concentrations,
        "years": years,
        "terms": terms,
        "default_year": default_year,
        "default_terms": ["Fall", "Spring"],
        "metrics": RAW_METRICS,
    }


def build_course(row, latest_bid_lookup):
    course_code = clean_text(row.get("course_code"))
    course_code_base = clean_text(row.get("course_code_base")) or course_code
    concentration = concentration_from_code(course_code_base or course_code)
    year = parse_year(row.get("year"))
    term = clean_text(row.get("term"))
    professor = clean_text(row.get("professor"))
    metrics_raw = {
        metric: parse_float(row.get(metric))
        for metric in RAW_METRICS
    }
    metrics_raw["Bid_Price"] = parse_float(row.get("bid_clearing_price"))
    metrics_raw["Bid_N_Bids"] = parse_float(row.get("bid_n_bids"))

    metrics_pct = {
        metric: parse_float(row.get(f"pct_{metric}"))
        for metric in RAW_METRICS
    }
    metrics_pct["Bid_Price"] = None
    metrics_pct["Bid_N_Bids"] = None

    latest_bid = latest_bid_lookup.get(course_code, {})
    has_bidding = parse_bool(row.get("has_bidding")) or metrics_raw["Bid_Price"] is not None or metrics_raw["Bid_N_Bids"] is not None

    return {
        "id": f"{course_code}||{year if year is not None else ''}||{term}||{professor}",
        "course_code": course_code,
        "course_code_base": course_code_base,
        "concentration": concentration,
        "year": year,
        "term": term,
        "professor": professor,
        "professor_display": professor_display(professor),
        "course_name": clean_text(row.get("course_name")),
        "description": clean_text(row.get("description")),
        "course_url": clean_text(row.get("course_url")),
        "is_stem": parse_bool(row.get("is_stem")),
        "is_core": parse_bool(row.get("core")),
        "has_eval": parse_bool(row.get("has_eval")),
        "has_bidding": has_bidding,
        "ever_bidding": course_code in latest_bid_lookup,
        "n_respondents": parse_int(row.get("n_respondents")),
        "metrics_raw": metrics_raw,
        "metrics_pct": metrics_pct,
        "instructor_label": instructor_label(metrics_raw["Instructor_Rating"]),
        "workload_label": workload_label(metrics_raw["Workload"]),
        "last_bid_price": latest_bid.get("last_bid_price"),
        "last_bid_acad": latest_bid.get("last_bid_acad"),
        "last_bid_term": latest_bid.get("last_bid_term"),
        "last_bid_capacity": latest_bid.get("last_bid_capacity"),
        "last_bid_n_bids": latest_bid.get("last_bid_n_bids"),
        "bid_clearing_price": metrics_raw["Bid_Price"],
        "bid_academic_year": nullable_text(row.get("bid_academic_year")),
        "bid_capacity": parse_int(row.get("bid_capacity")),
        "bid_n_bids": parse_int(row.get("bid_n_bids")),
        "stem_group": nullable_text(row.get("stem_group")),
        "stem_school": nullable_text(row.get("stem_school")),
        "faculty_title": nullable_text(row.get("faculty_title")),
        "faculty_category": nullable_text(row.get("faculty_category")),
    }


def main():
    if not SOURCE_CSV.exists():
        raise FileNotFoundError(f"Canonical CSV not found: {SOURCE_CSV}")

    with SOURCE_CSV.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle, delimiter=";"))

    bid_rows_by_course = defaultdict(list)
    for row in rows:
        course_code = clean_text(row.get("course_code"))
        if not course_code:
            continue
        if any(
            [
                clean_text(row.get("bid_academic_year")),
                clean_text(row.get("bid_clearing_price")),
                clean_text(row.get("bid_capacity")),
                clean_text(row.get("bid_n_bids")),
            ]
        ):
            bid_rows_by_course[course_code].append(row)

    latest_bid_lookup = {}
    for course_code, bid_rows in bid_rows_by_course.items():
        latest = max(bid_rows, key=bid_sort_key)
        latest_bid_lookup[course_code] = {
            "last_bid_price": parse_float(latest.get("bid_clearing_price")),
            "last_bid_acad": nullable_text(latest.get("bid_academic_year")),
            "last_bid_term": clean_text(latest.get("term")),
            "last_bid_capacity": parse_int(latest.get("bid_capacity")),
            "last_bid_n_bids": parse_int(latest.get("bid_n_bids")),
        }

    courses = [build_course(row, latest_bid_lookup) for row in rows]
    payload = {"courses": courses, "meta": meta_from_courses(courses)}
    OUTPUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"Wrote {len(courses)} courses to {OUTPUT_JSON}")
    print(f"Canonical source: {SOURCE_CSV}")


if __name__ == "__main__":
    main()
