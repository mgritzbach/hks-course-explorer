"""Build an additive, versioned current-course catalogue snapshot.

The snapshot builder is deliberately pure: callers supply current Harvard
offerings, historical course rows, and a reviewed renumbering map. It does not
write to Supabase. That separation lets a future sync validate and compare a
snapshot before any production promotion.
"""

from collections import defaultdict
import re


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
        records = direct.get(code, []) if code else []
        match_method = "exact_code" if records else None

        if not records and code:
            records = approved_aliases.get(code, [])
            match_method = "approved_alias" if records else None

        historical_codes = sorted({course_code(row) for row in records if course_code(row)})
        snapshot.append(
            {
                "offering_id": str(offering["id"]),
                "course_code": offering.get("course_code"),
                "course_code_base": offering.get("course_code_base"),
                "term": offering.get("term"),
                "school": offering.get("school"),
                "title": offering.get("title"),
                "instructors": offering.get("instructors") or [],
                "canonical_course_code": code if records else None,
                "match_status": "verified" if records else "unmatched",
                "match_method": match_method,
                "historical_course_codes": historical_codes,
                "evaluation_summary": build_evaluation_summary(records),
                "historical_records": records,
            }
        )

    return sorted(snapshot, key=lambda row: row["offering_id"])
