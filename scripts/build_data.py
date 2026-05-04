import csv
import hashlib
import json
from collections import defaultdict
from pathlib import Path
import re
import math


ROOT = Path(__file__).resolve().parent.parent
SOURCE_CSV = ROOT / "data" / "canonical_courses_enriched.csv"
OUTPUT_JSON = ROOT / "public" / "courses.json"
SIM_HASH_FILE = ROOT / "public" / ".sim_coords_hash"

# Core course codes — backfill is_core=True for any year where the CSV column
# is missing (data source didn't tag 2024+ rows).
CORE_COURSE_CODES = {
    "API-101", "API-102", "API-201", "API-202", "API-202-M",
    "API-501", "API-502",
    "DPI-200", "DPI-201", "DPI-202", "DPI-202-M",
    "DPI-385-M", "DPI-386-M",
    "MLD-220-M", "MLD-221", "MLD-222-M",
}

# Maps old course_code_base values to their current canonical equivalent.
# Rows with an old code get historical_code=<old> and canonical_code_base=<new>.
HISTORICAL_CODE_MAP = {
    # PED → DEV (Development dept renamed ~2017)
    "PED-250":    "DEV-250",
    "PED-130":    "DEV-130",
    "PED-210":    "DEV-210",
    "PED-309":    "DEV-309",
    "PED-308":    "DEV-308",
    "PED-150":    "DEV-150",
    "PED-502":    "DEV-502",
    "PED-501-M":  "DEV-501-M",
    "PED-312":    "DPI-450",
    # PAL / MLD-717 family → DPI-802-M (Arts of Communication)
    "PAL-117":    "DPI-802-M",
    "PAL-117-M":  "DPI-802-M",
    "MLD-717":    "DPI-802-M",
    "MLD-717-M":  "DPI-802-M",
    "DPI-801":    "DPI-802-M",
    # Other PAL → DPI/MLD migrations
    "PAL-110":    "DPI-101",
    "PAL-115":    "DPI-115",
    "PAL-210":    "DPI-120",
    "PAL-230":    "DPI-330",
    "PAL-142":    "MLD-342",
    "DPI-890":    "DPI-330",
    # STM → MLD (Strategic Management moved)
    "STM-221":    "MLD-221",
    "STM-101":    "MLD-101",
    "STM-102":    "MLD-102",
    "STM-110":    "MLD-110",
    "STM-301":    "MLD-601",
    "STM-401-M":  "MLD-401-M",
    "STM-117-M":  "MLD-617-M",
    # HUT / HCP → SUP
    "HUT-268":    "SUP-668",
    "HUT-201":    "SUP-601",
    "HCP-272":    "SUP-572",
    # ISP → IGA
    "ISP-103":    "IGA-103",
    # Sequential renumbers
    "IGA-306":    "IGA-220",
    "DPI-810-M":  "MLD-718-M",
    "DPI-811-M":  "MLD-719-M",
}

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


def parse_meeting_days(value):
    if value is None:
        return None
    if isinstance(value, list):
        days = [clean_text(item) for item in value if clean_text(item)]
        return days or None
    text = clean_text(value)
    if not text:
        return None
    if text.startswith("[") and text.endswith("]"):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                days = [clean_text(item) for item in parsed if clean_text(item)]
                return days or None
        except json.JSONDecodeError:
            pass
    days = [clean_text(part) for part in re.split(r"[|,;/]+", text) if clean_text(part)]
    return days or None


def load_existing_schedule_overrides():
    if not OUTPUT_JSON.exists():
        return {}
    try:
        payload = json.loads(OUTPUT_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}

    overrides = {}
    for course in payload.get("courses", []):
        overrides[course.get("id")] = {
            "meeting_days": parse_meeting_days(course.get("meeting_days")),
            "meeting_time": nullable_text(course.get("meeting_time")),
            "meeting_time_end": nullable_text(course.get("meeting_time_end")),
        }
    return overrides


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
    # Default to the latest year that has actual evaluation data (excludes future bidding-only years)
    eval_years = [c["year"] for c in courses if c.get("year") and c.get("has_eval") and not c.get("is_average")]
    default_year = max(eval_years) if eval_years else max((year for year in years if year and year > 0), default=max(years or [0]))

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


def _pca_2d(matrix, random_state=42):
    """Reduce any matrix to 2D via PCA, normalized to [-100, 100]."""
    from sklearn.decomposition import PCA
    import numpy as np
    n_components = min(50, matrix.shape[1], matrix.shape[0] - 1)
    if n_components > 2:
        reduced = PCA(n_components=n_components, random_state=random_state).fit_transform(matrix)
    else:
        reduced = matrix
    coords = PCA(n_components=2, random_state=random_state).fit_transform(reduced)
    for dim in range(2):
        col = coords[:, dim]
        col_min, col_max = col.min(), col.max()
        coords[:, dim] = ((col - col_min) / (col_max - col_min) * 200 - 100) if col_max > col_min else np.zeros_like(col)
    return coords


def compute_all_similarity_coords(courses):
    """
    Compute three PCA variants for the Similarity Map:
      combined  → ratings (2.5×) + text    [sim_x / sim_y]
      ratings   → eval metrics only         [sim_x_ratings / sim_y_ratings]
      text      → course names/descriptions [sim_x_text / sim_y_text]

    Returns dict mapping course id -> {x, y, x_ratings, y_ratings, x_text, y_text}.
    """
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
        import numpy as np
    except ImportError:
        print("sklearn not available – skipping similarity map coordinates")
        return {}

    METRIC_KEYS = [
        "Instructor_Rating", "Course_Rating", "Workload", "Rigor",
        "Diverse Perspectives", "Feedback", "Insights", "Availability",
        "Discussions", "Discussion Diversity", "Readings", "Assignments",
    ]

    eligible = [c for c in courses if c.get("has_eval") and not c.get("is_average") and c.get("year") and c["year"] > 0]
    if len(eligible) < 10:
        return {}

    ids = [c["id"] for c in eligible]

    # Metric matrix (0-1 normalised)
    metric_matrix = np.array([
        [(c.get("metrics_raw", {}).get(k) - 1) / 4.0 if c.get("metrics_raw", {}).get(k) is not None else 0.5
         for k in METRIC_KEYS]
        for c in eligible
    ], dtype=np.float32)

    # Text matrix (TF-IDF)
    descriptions = [
        f"{c.get('course_name', '')} {c.get('description', '')} {c.get('concentration', '')}"
        for c in eligible
    ]
    try:
        tfidf = TfidfVectorizer(max_features=150, stop_words='english', min_df=2)
        text_matrix = tfidf.fit_transform(descriptions).toarray().astype(np.float32)
    except Exception:
        text_matrix = np.zeros((len(eligible), 1), dtype=np.float32)

    coords_combined = _pca_2d(np.hstack([metric_matrix * 2.5, text_matrix]))
    coords_ratings  = _pca_2d(metric_matrix)
    coords_text     = _pca_2d(text_matrix)

    return {
        ids[i]: {
            "x":          round(float(coords_combined[i, 0]), 2),
            "y":          round(float(coords_combined[i, 1]), 2),
            "x_ratings":  round(float(coords_ratings[i, 0]),  2),
            "y_ratings":  round(float(coords_ratings[i, 1]),  2),
            "x_text":     round(float(coords_text[i, 0]),     2),
            "y_text":     round(float(coords_text[i, 1]),     2),
        }
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
    meeting_days = parse_meeting_days(row.get("meeting_days"))
    meeting_time = nullable_text(row.get("meeting_time"))
    meeting_time_end = nullable_text(row.get("meeting_time_end"))

    return {
        "id": f"{course_code}||{year if year is not None else ''}||{term}||{professor}",
        "course_code": course_code,
        "course_code_base": course_code_base,
        "historical_code": course_code_base if course_code_base in HISTORICAL_CODE_MAP else None,
        "canonical_code_base": HISTORICAL_CODE_MAP.get(course_code_base, course_code_base),
        "concentration": concentration,
        "year": year,
        "term": term,
        "professor": professor,
        "professor_display": professor_display(professor),
        "course_name": clean_text(row.get("course_name")),
        "description": clean_text(row.get("description")),
        "course_url": clean_text(row.get("course_url")),
        "is_stem": parse_bool(row.get("is_stem")),
        "is_core": parse_bool(row.get("core")) or (HISTORICAL_CODE_MAP.get(course_code_base, course_code_base) in CORE_COURSE_CODES),
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
        "meeting_days": meeting_days,
        "meeting_time": meeting_time,
        "meeting_time_end": meeting_time_end,
    }


def validate_rows(rows):
    """
    Sanity-check raw CSV rows before processing.
    Raises ValueError with a clear message if anything looks wrong.
    Prints a warning summary for recoverable issues (missing optional fields).
    """
    errors = []
    warnings = []
    VALID_TERMS = {"Fall", "Spring", "January", "Average", ""}
    REQUIRED_FIELDS = ["course_code", "course_name", "professor", "year", "term"]

    for i, row in enumerate(rows, start=2):  # row 1 is the header
        code = row.get("course_code", "").strip()
        label = f"Row {i} ({code or 'no code'})"

        # Required fields must not be blank
        for field in REQUIRED_FIELDS:
            if not row.get(field, "").strip():
                # course_name and professor are soft warnings (averaged rows can lack them)
                if field in ("course_name", "professor"):
                    warnings.append(f"{label}: missing '{field}'")
                else:
                    errors.append(f"{label}: required field '{field}' is blank")

        # Year must parse to a 4-digit integer if present (CSV may store as float e.g. "2023.0")
        # Average/aggregate rows intentionally have year=0 — skip range check for those
        year_str = row.get("year", "").strip()
        is_avg = row.get("is_average", "").strip().lower() in ("true", "1", "yes")
        if year_str and not is_avg:
            try:
                year_int = int(float(year_str))
                if year_int != 0 and not (1900 <= year_int <= 2100):
                    errors.append(f"{label}: year {year_int} out of expected range [1900, 2100]")
            except ValueError:
                errors.append(f"{label}: invalid year '{year_str}' (cannot parse as number)")

        # Term must be a known value if present
        term = row.get("term", "").strip()
        if term and term not in VALID_TERMS:
            warnings.append(f"{label}: unexpected term '{term}'")

        # Ratings must be 1–5 if present
        for rating_key in ("Instructor_Rating", "Course_Rating", "Workload"):
            val_str = row.get(rating_key, "").strip()
            if val_str:
                try:
                    val = float(val_str)
                    if not (0.0 <= val <= 5.0):
                        errors.append(f"{label}: {rating_key}={val} out of range [0, 5]")
                except ValueError:
                    errors.append(f"{label}: {rating_key}='{val_str}' is not a number")

    if warnings:
        print(f"  Validation: {len(warnings)} warnings (e.g. {warnings[0]})")
    if errors:
        error_list = "\n  ".join(errors[:20])
        raise ValueError(
            f"Data validation failed with {len(errors)} error(s):\n  {error_list}"
            + ("\n  (+ more)" if len(errors) > 20 else "")
        )


def main():
    if not SOURCE_CSV.exists():
        raise FileNotFoundError(f"Canonical CSV not found: {SOURCE_CSV}")

    with SOURCE_CSV.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle, delimiter=";"))

    print(f"Validating {len(rows)} rows...")
    validate_rows(rows)

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

    schedule_overrides = load_existing_schedule_overrides()
    courses = [build_course(row, latest_bid_lookup) for row in rows]
    for course in courses:
        override = schedule_overrides.get(course["id"])
        if not override:
            continue
        if not course.get("meeting_days") and override.get("meeting_days"):
            course["meeting_days"] = override["meeting_days"]
        if not course.get("meeting_time") and override.get("meeting_time"):
            course["meeting_time"] = override["meeting_time"]
        if not course.get("meeting_time_end") and override.get("meeting_time_end"):
            course["meeting_time_end"] = override["meeting_time_end"]

    # --- Similarity map: only recompute when source data changes ---
    SIM_JSON = ROOT / "public" / "sim_coords.json"
    SIM_SRC  = ROOT / "src" / "data" / "sim_coords.json"

    csv_hash = hashlib.md5(SOURCE_CSV.read_bytes()).hexdigest()
    cached_hash = SIM_HASH_FILE.read_text(encoding="utf-8").strip() if SIM_HASH_FILE.exists() else ""
    sim_coords_cached = SIM_JSON.exists() and csv_hash == cached_hash

    if sim_coords_cached:
        print("Similarity coords up-to-date (source unchanged) — loading from cache")
        existing = json.loads(SIM_JSON.read_text(encoding="utf-8"))
        sim_coords = {entry["id"]: {"x": entry["sim_x"], "y": entry["sim_y"]} for entry in existing}
    else:
        print("Computing similarity map coordinates (combined / ratings / text)...")
        sim_coords = compute_all_similarity_coords(courses)
        sim_slim = [
            {
                "id":            course["id"],
                "course_code":   course.get("course_code"),
                "course_name":   course.get("course_name"),
                "professor_display": course.get("professor_display"),
                "concentration": course.get("concentration"),
                "is_stem":       course.get("is_stem", False),
                "sim_x":         c["x"],
                "sim_y":         c["y"],
                "sim_x_ratings": c["x_ratings"],
                "sim_y_ratings": c["y_ratings"],
                "sim_x_text":    c["x_text"],
                "sim_y_text":    c["y_text"],
            }
            for course in courses
            if (c := sim_coords.get(course["id"]))
        ]
        sim_json_str = json.dumps(sim_slim, ensure_ascii=False, separators=(",", ":"))
        SIM_JSON.write_text(sim_json_str, encoding="utf-8")
        SIM_SRC.parent.mkdir(parents=True, exist_ok=True)
        SIM_SRC.write_text(sim_json_str, encoding="utf-8")
        SIM_HASH_FILE.write_text(csv_hash, encoding="utf-8")
        print(f"Wrote {len(sim_slim)} sim coords to {SIM_JSON} and {SIM_SRC}")

    for course in courses:
        c = sim_coords.get(course["id"])
        course["sim_x"] = c["x"] if c else None
        course["sim_y"] = c["y"] if c else None

    payload = {"courses": courses, "meta": meta_from_courses(courses)}
    OUTPUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"Wrote {len(courses)} courses to {OUTPUT_JSON}")
    print(f"Canonical source: {SOURCE_CSV}")


if __name__ == "__main__":
    main()
