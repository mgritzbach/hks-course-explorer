import csv
import json
from collections import defaultdict
from pathlib import Path
import re
import math


ROOT = Path(__file__).resolve().parent.parent
SOURCE_CSV = ROOT / "data" / "canonical_courses_enriched.csv"
OUTPUT_JSON = ROOT / "public" / "courses.json"

METRICS = [
    {"key": "Instructor_Rating", "label": "Instructor Rating", "higher_is_better": True},
    {"key": "Course_Rating", "label": "Course Rating", "higher_is_better": True},
    {"key": "Workload", "label": "Workload", "higher_is_better": False},
    {"key": "Assignments", "label": "Assignment Value", "higher_is_better": True},
    {"key": "Availability", "label": "Availability", "higher_is_better": True},
    {"key": "Discussions", "label": "Class Discussions", "higher_is_better": True},
    {"key": "Diverse Perspectives", "label": "Diverse Perspectives", "higher_is_better": True},
    {"key": "Feedback", "label": "Feedback", "higher_is_better": True},
    {"key": "Discussion Diversity", "label": "Discussion Diversity", "higher_is_better": True},
    {"key": "Rigor", "label": "Rigor", "higher_is_better": True},
    {"key": "Readings", "label": "Readings", "higher_is_better": False},
    {"key": "Insights", "label": "Insights", "higher_is_better": True},
    {"key": "Bid_Price", "label": "Bid Price", "higher_is_better": False, "bid_metric": True},
    {"key": "Bid_N_Bids", "label": "Number of Bids", "higher_is_better": False, "bid_metric": True},
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


def parse_year_range(value):
    text = clean_text(value)
    if not text:
        return (None, None)
    numbers = [int(match) for match in re.findall(r"\d{4}", text)]
    if not numbers:
        return (None, None)
    if len(numbers) == 1:
        return (numbers[0], numbers[0])
    return (numbers[0], numbers[1])


def average(values):
    if not values:
        return None
    return sum(values) / len(values)


def median(values):
    if not values:
        return None
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    mid = n // 2
    if n % 2 == 0:
        return (sorted_vals[mid - 1] + sorted_vals[mid]) / 2
    return sorted_vals[mid]


def format_numeric(value, decimals=2):
    if value is None:
        return ""
    rounded = round(value, decimals)
    if abs(rounded - round(rounded)) < 1e-9:
        return str(int(round(rounded)))
    return f"{rounded:.{decimals}f}".rstrip("0").rstrip(".")


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

    # Compute per-year median instructor ratings (raw 0-5 scale)
    year_medians = {}
    for year in years:
        year_courses = [c for c in courses if c.get("year") == year and not c.get("is_average") and c.get("metrics_raw", {}).get("Instructor_Rating") is not None]
        raw_vals = [c["metrics_raw"]["Instructor_Rating"] for c in year_courses]
        year_medians[str(year)] = round(median(raw_vals), 3) if raw_vals else None

    overall_courses = [c for c in courses if not c.get("is_average") and c.get("metrics_raw", {}).get("Instructor_Rating") is not None]
    overall_median = round(median([c["metrics_raw"]["Instructor_Rating"] for c in overall_courses]), 3) if overall_courses else None

    return {
        "concentrations": concentrations,
        "years": years,
        "terms": [term for term in terms if term != "Average"],
        "default_year": default_year,
        "default_terms": ["Fall", "Spring"],
        "metrics": METRICS,
        "year_medians_instructor": year_medians,
        "overall_median_instructor": overall_median,
    }


def fill_average_bid_fields(rows):
    historical_rows_by_code = defaultdict(list)

    for row in rows:
        course_code = clean_text(row.get("course_code"))
        if not course_code or parse_bool(row.get("is_average")):
            continue
        historical_rows_by_code[course_code].append(row)

    updated = 0
    for row in rows:
        if not parse_bool(row.get("is_average")):
            continue

        course_code = clean_text(row.get("course_code"))
        if not course_code:
            continue

        candidates = historical_rows_by_code.get(course_code, [])
        if not candidates:
            continue

        start_year, end_year = parse_year_range(row.get("year_range"))
        if start_year is not None and end_year is not None:
            candidates = [
                candidate
                for candidate in candidates
                if (candidate_year := parse_year(candidate.get("year"))) is not None
                and start_year <= candidate_year <= end_year
            ]

        if not candidates:
            continue

        price_values = [
            value for value in (parse_float(candidate.get("bid_clearing_price")) for candidate in candidates)
            if value is not None
        ]
        bid_count_values = [
            value for value in (parse_float(candidate.get("bid_n_bids")) for candidate in candidates)
            if value is not None
        ]

        if not clean_text(row.get("bid_clearing_price")) and price_values:
            row["bid_clearing_price"] = format_numeric(average(price_values), decimals=2)
            updated += 1

        if not clean_text(row.get("bid_n_bids")) and bid_count_values:
            row["bid_n_bids"] = format_numeric(average(bid_count_values), decimals=2)

        if price_values or bid_count_values:
            row["has_bidding"] = "True"

    return updated


def compute_similarity_coords(courses):
    """
    Compute 2D similarity coordinates for the Similarity Map.
    Uses metric-based feature vectors + course description text features.
    Falls back to PCA-style random projection if sklearn unavailable.

    Returns dict mapping course id -> [x, y] or None if computation fails.
    """
    try:
        from sklearn.preprocessing import StandardScaler
        from sklearn.decomposition import PCA
        from sklearn.feature_extraction.text import TfidfVectorizer
        import numpy as np
    except ImportError:
        print("sklearn not available - skipping similarity map coordinates")
        return {}

    METRIC_KEYS = [
        "Instructor_Rating", "Course_Rating", "Workload", "Rigor",
        "Diverse Perspectives", "Feedback", "Insights", "Availability",
        "Discussions", "Discussion Diversity", "Readings", "Assignments",
    ]

    # Only use courses that have eval data (not average rows, not bidding-only)
    eligible = [c for c in courses if c.get("has_eval") and not c.get("is_average") and c.get("year") and c["year"] > 0]

    if len(eligible) < 10:
        return {}

    ids = [c["id"] for c in eligible]

    # Build metric feature matrix (normalized 0-1)
    metric_rows = []
    for c in eligible:
        row = []
        for key in METRIC_KEYS:
            val = c.get("metrics_raw", {}).get(key)
            # Normalize: 1-5 scale → 0-1
            row.append((val - 1) / 4.0 if val is not None else 0.5)
        metric_rows.append(row)

    metric_matrix = np.array(metric_rows, dtype=np.float32)

    # Build text feature matrix from course descriptions
    descriptions = [
        f"{c.get('course_name', '')} {c.get('description', '')} {c.get('concentration', '')}"
        for c in eligible
    ]

    try:
        tfidf = TfidfVectorizer(max_features=150, stop_words='english', min_df=2)
        text_matrix = tfidf.fit_transform(descriptions).toarray().astype(np.float32)
    except Exception:
        text_matrix = np.zeros((len(eligible), 1), dtype=np.float32)

    # Combine metric and text features (metrics weighted more heavily)
    combined = np.hstack([metric_matrix * 2.5, text_matrix])

    # Reduce to 2D using PCA
    n_components = min(50, combined.shape[1], combined.shape[0] - 1)
    if n_components > 2:
        pca_intermediate = PCA(n_components=n_components, random_state=42)
        reduced = pca_intermediate.fit_transform(combined)
    else:
        reduced = combined

    pca_2d = PCA(n_components=2, random_state=42)
    coords_2d = pca_2d.fit_transform(reduced)

    # Normalize to [-100, 100] range
    for dim in range(2):
        col = coords_2d[:, dim]
        col_min, col_max = col.min(), col.max()
        if col_max > col_min:
            coords_2d[:, dim] = ((col - col_min) / (col_max - col_min) * 200) - 100
        else:
            coords_2d[:, dim] = 0.0

    return {
        ids[i]: [round(float(coords_2d[i, 0]), 2), round(float(coords_2d[i, 1]), 2)]
        for i in range(len(ids))
    }


def build_course(row, latest_bid_lookup):
    course_code = clean_text(row.get("course_code"))
    course_code_base = clean_text(row.get("course_code_base")) or course_code
    concentration = concentration_from_code(course_code_base or course_code)
    year = parse_year(row.get("year"))
    term = clean_text(row.get("term"))
    professor = clean_text(row.get("professor"))
    metrics_raw = {
        metric["key"]: parse_float(row.get(metric["key"]))
        for metric in METRICS
        if not metric.get("bid_metric")
    }
    metrics_raw["Bid_Price"] = parse_float(row.get("bid_clearing_price"))
    metrics_raw["Bid_N_Bids"] = parse_float(row.get("bid_n_bids"))

    metrics_pct = {
        metric["key"]: parse_float(row.get(f"pct_{metric['key']}"))
        for metric in METRICS
        if not metric.get("bid_metric")
    }
    metrics_pct["Bid_Price"] = None
    metrics_pct["Bid_N_Bids"] = None

    # Score = weighted average / 5 × 100  (5-point scale → 0-100%, where 5=100%)
    metrics_score = {}
    for metric in METRICS:
        if not metric.get("bid_metric"):
            raw_val = metrics_raw.get(metric["key"])
            metrics_score[metric["key"]] = round(raw_val / 5.0 * 100, 1) if raw_val is not None else None
    metrics_score["Bid_Price"] = None
    metrics_score["Bid_N_Bids"] = None

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
        "is_average": parse_bool(row.get("is_average")),
        "year_range": nullable_text(row.get("year_range")),
        "n_terms": parse_int(row.get("n_terms")),
        "has_eval": parse_bool(row.get("has_eval")),
        "has_bidding": has_bidding,
        "ever_bidding": course_code in latest_bid_lookup,
        "n_respondents": parse_int(row.get("n_respondents")),
        "metrics_raw": metrics_raw,
        "metrics_pct": metrics_pct,
        "metrics_score": metrics_score,
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

    fill_average_bid_fields(rows)

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

    # Compute similarity map coordinates
    print("Computing similarity map coordinates...")
    sim_coords = compute_similarity_coords(courses)
    for course in courses:
        coords = sim_coords.get(course["id"])
        course["sim_x"] = coords[0] if coords else None
        course["sim_y"] = coords[1] if coords else None
    print(f"Similarity coords computed for {len(sim_coords)} courses")

    payload = {"courses": courses, "meta": meta_from_courses(courses)}
    OUTPUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"Wrote {len(courses)} courses to {OUTPUT_JSON}")
    print(f"Canonical source: {SOURCE_CSV}")


if __name__ == "__main__":
    main()
