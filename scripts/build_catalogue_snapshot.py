"""Build an additive, versioned current-course catalogue snapshot.

The snapshot builder is deliberately pure: callers supply current Harvard
offerings, historical course rows, and a reviewed renumbering map. It does not
write to Supabase. That separation lets a future sync validate and compare a
snapshot before any production promotion.
"""

from collections import defaultdict
import re
import unicodedata


def normalise_course_code(value):
    """Normalise presentation differences without weakening course identity."""
    if not isinstance(value, str):
        return None
    code = value.strip().upper().replace("\u2013", "-").replace("\u2014", "-")
    code = re.sub(r"\s*-\s*", "-", code)
    code = re.sub(r"\s+", "-", code)
    return code or None


def course_code(record):
    if not isinstance(record, dict):
        return None
    return normalise_course_code(record.get("course_code_base") or record.get("course_code"))


def normalise_instructor_name(value):
    """Create a stable professor key across 'Last, First' and 'First Last'."""
    if not isinstance(value, str):
        return None
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    tokens = re.findall(r"[a-z]+", re.sub(r"\b(professor|prof|doctor|dr)\b", "", ascii_value.lower()))
    tokens = sorted(token for token in tokens if len(token) > 1)
    return " ".join(tokens) if tokens else None


def normalise_course_title(value):
    """Return a conservative title key for human-review candidate detection."""
    if not isinstance(value, str):
        return None
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    tokens = re.findall(r"[a-z0-9]+", ascii_value.lower())
    return " ".join(tokens) if tokens else None


def instructor_keys(record):
    """Return one or more explicit professor identities from either source shape."""
    if not isinstance(record, dict):
        return []
    values = record.get("instructors") if isinstance(record.get("instructors"), list) else [
        record.get("professor_display"),
        record.get("professor"),
        record.get("instructor_label"),
    ]
    return sorted({normalise_instructor_name(value) for value in values if normalise_instructor_name(value)})


def shared_instructor(offering, historical_row):
    return bool(set(instructor_keys(offering)) & set(instructor_keys(historical_row)))


def probable_section_base(code):
    """Return only a terminal A/B/C-style variant candidate, never an auto-link."""
    return code[:-2] if isinstance(code, str) and re.search(r"-[A-Z]$", code) else None


def truthy(value):
    return value is True or (isinstance(value, str) and value.strip().lower() == "true")


def build_historical_index(historical_rows, historical_code_map):
    """Create exact and reviewed-alias historical lookup tables."""
    direct = defaultdict(list)
    aliases = {
        normalise_course_code(old): normalise_course_code(new)
        for old, new in (historical_code_map or {}).items()
        if normalise_course_code(old) and normalise_course_code(new)
    }
    approved_aliases = defaultdict(list)

    for row in historical_rows or []:
        code = course_code(row)
        if not code:
            continue
        direct[code].append(row)
        if code in aliases:
            approved_aliases[aliases[code]].append(row)

    return direct, approved_aliases


def build_evaluation_summary(records):
    """Summarise provenance without treating absent evaluations as zero ratings."""
    observed_rows = [row for row in records if not truthy(row.get("is_average"))]
    evaluated_rows = [row for row in observed_rows if truthy(row.get("has_eval"))]
    years = sorted(
        {
            int(row["year"])
            for row in evaluated_rows
            if str(row.get("year", "")).isdigit() and int(row["year"]) > 0
        }
    )
    return {
        "observed_offering_count": len(observed_rows),
        "evaluated_offering_count": len(evaluated_rows),
        "evaluation_years": years,
    }


def materialize_catalogue_snapshot(offerings, historical_rows, historical_code_map):
    """Return one safe public record per current offering.

    Exact code and reviewed alias mappings may link history. Similar titles,
    instructors, prefixes, and suffix-stripped codes remain unmatched.
    """
    direct, approved_aliases = build_historical_index(historical_rows, historical_code_map)
    snapshot = []

    for offering in offerings or []:
        if not isinstance(offering, dict) or not offering.get("id"):
            raise ValueError("Every current offering needs its immutable source id.")

        code = course_code(offering)
        course_history_records = direct.get(code, []) if code else []
        source_method = "exact_code" if course_history_records else None

        if not course_history_records and code:
            course_history_records = approved_aliases.get(code, [])
            source_method = "approved_alias" if course_history_records else None

        teaching_records = [row for row in course_history_records if shared_instructor(offering, row)]
        historical_codes = sorted({course_code(row) for row in course_history_records if course_code(row)})
        review_candidates = []
        renumbering_review_candidates = []
        if not course_history_records and code:
            section_base = probable_section_base(code)
            if section_base:
                review_candidates = [
                    row for row in direct.get(section_base, []) if shared_instructor(offering, row)
                ]
            offering_title = normalise_course_title(offering.get("title"))
            if offering_title:
                renumbering_review_candidates = [
                    row
                    for row in historical_rows or []
                    if course_code(row) != code
                    and normalise_course_title(row.get("course_name")) == offering_title
                    and shared_instructor(offering, row)
                ]

        if teaching_records:
            match_status = "verified"
            match_method = f"{source_method}_same_professor"
        elif course_history_records:
            match_status = "course_only"
            professor_scope = "other_professor" if instructor_keys(offering) else "professor_unavailable"
            match_method = f"{source_method}_{professor_scope}"
        elif review_candidates or renumbering_review_candidates:
            match_status = "needs_review"
            if review_candidates and renumbering_review_candidates:
                match_method = "suspected_section_split_and_renumbering"
            elif review_candidates:
                match_method = "suspected_section_split"
            else:
                match_method = "suspected_renumbering_same_professor_title"
            historical_codes = sorted(
                {
                    course_code(row)
                    for row in [*review_candidates, *renumbering_review_candidates]
                    if course_code(row)
                }
            )
        else:
            match_status = "unmatched"
            match_method = None

        snapshot.append(
            {
                "offering_id": str(offering["id"]),
                "course_code": offering.get("course_code"),
                "course_code_base": offering.get("course_code_base"),
                "term": offering.get("term"),
                "school": offering.get("school"),
                "title": offering.get("title"),
                "instructors": offering.get("instructors") or [],
                "canonical_course_code": code if match_status in {"verified", "course_only"} else None,
                "current_instructor_keys": instructor_keys(offering),
                "match_status": match_status,
                "match_method": match_method,
                "historical_course_codes": historical_codes,
                # Only same-professor records become current-offering ratings.
                "evaluation_summary": build_evaluation_summary(teaching_records),
                "course_history_summary": build_evaluation_summary(course_history_records),
                "historical_records": teaching_records,
                "course_history_records": course_history_records,
                "review_candidates": review_candidates,
                # These require explicit human alias approval before any
                # teaching history or ratings can be shown on the offering.
                "renumbering_review_candidates": renumbering_review_candidates,
            }
        )

    return sorted(snapshot, key=lambda row: row["offering_id"])
