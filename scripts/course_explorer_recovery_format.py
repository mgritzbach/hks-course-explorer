"""Versioned contract for the encrypted Course Explorer recovery package."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path


RECOVERY_FORMAT = "hks-course-explorer-recovery-v2"
SOURCE_COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}$")
RECOVERY_CONTRACT_PATHS = (
    ".github/workflows/backup-course-explorer-recovery.yml",
    ".github/workflows/verify-course-explorer-recovery.yml",
    "scripts/course_explorer_recovery_format.py",
    "scripts/export_course_explorer_recovery.py",
    "scripts/verify_course_explorer_recovery.py",
    "scripts/recovery_ciphertext_hmac.py",
    "scripts/restore_course_explorer_recovery.sql",
    "scripts/rollback_ats_manifest_visibility.sql",
    "scripts/verify_ats_manifest_exercise.sql",
    "scripts/verify_ats_manifest_migration_isolation.sql",
    "scripts/verify_myharvard_rollback_exercise.sql",
    "scripts/verify_course_explorer_schema.sql",
    "scripts/export_course_explorer_schema_contract.sql",
    "scripts/export_course_explorer_restored_rows.sql",
    "supabase/recovery/course_explorer_base.sql",
    "supabase/recovery/course_explorer_schema_contract.txt",
    "supabase/migrations/20260710230627_restrict_course_explorer_browser_writes.sql",
    "supabase/migrations/20260710235500_atomic_live_course_sync.sql",
    "supabase/migrations/20260712060918_authoritative_myharvard_hks_catalogue.sql",
    "supabase/migrations/20260712062903_fix_myharvard_staging_isolation_and_rollback.sql",
    "supabase/migrations/20260712065000_make_myharvard_snapshot_retention_deterministic.sql",
    "supabase/migrations/20260712070000_serialize_and_guard_catalogue_promotions.sql",
    "supabase/migrations/20260712092831_isolate_non_hks_ats_activation.sql",
    "supabase/migrations/20260712193000_persist_hks_catalogue_manifest.sql",
    "supabase/migrations/20260712200000_revoke_course_explorer_browser_write_grants.sql",
    "supabase/migrations/20260712213000_revoke_course_sections_browser_write_grants.sql",
    "supabase/migrations/20260712213500_assert_course_sections_browser_grant_postconditions.sql",
    "supabase/migrations/20260712224500_harden_maintain_and_trigger_function_grants.sql",
    "supabase/migrations/20260713150805_harden_refresh_synced_at_search_path.sql",
    "supabase/migrations/20260714075356_persist_ats_source_manifest.sql",
    "supabase/migrations/20260714102702_raise_ats_promotion_statement_timeout.sql",
)
TABLE_ORDER = (
    "courses",
    "course_sections",
    "schedules",
    "live_catalogue_runs",
    "live_courses",
)

TABLE_COLUMNS = {
    "courses": frozenset(
        {
            "id", "course_code", "course_code_base", "concentration", "year", "term",
            "is_average", "year_range", "n_terms", "professor", "professor_display",
            "faculty_title", "faculty_category", "course_name", "description", "course_url",
            "is_stem", "stem_group", "stem_school", "is_core", "has_eval", "n_respondents",
            "total_n_respondents", "metrics_raw", "metrics_pct", "instructor_label",
            "workload_label", "has_bidding", "ever_bidding", "last_bid_price", "last_bid_acad",
            "last_bid_term", "last_bid_capacity", "last_bid_n_bids", "bid_clearing_price",
            "bid_academic_year", "bid_capacity", "bid_n_bids", "meeting_days", "time_start",
            "time_end", "location",
        }
    ),
    "course_sections": frozenset(
        {
            "id", "course_code_base", "course_code", "term", "harvard_id", "section_type",
            "title", "credits", "instructors", "meetings", "is_active", "raw", "fetched_at",
        }
    ),
    "schedules": frozenset(
        {"id", "user_id", "plan_name", "plan_data", "created_at", "updated_at"}
    ),
    "live_catalogue_runs": frozenset(
        {
            "id", "source", "status", "offering_count", "source_snapshot_at", "created_at",
            "activated_at", "identity_sha256", "term_counts",
        }
    ),
    "live_courses": frozenset(
        {
            "id", "course_code", "course_code_base", "title", "term", "credits", "instructors",
            "description", "location", "meeting_days", "time_start", "time_end", "school",
            "is_hks", "synced_at", "session_code", "session_description", "cross_reg_eligible",
            "source", "source_course_id", "course_offer_nbr", "section_code", "source_url",
            "sync_run_id", "active", "source_offering_id", "source_last_seen_at",
        }
    ),
}

# A recovery point must exist before the migration that adds this nullable
# column. The exporter accepts only this exact pre-migration shape and records
# the absent value as null so the package can be restored into the reviewed
# post-migration schema. No other missing or extra column is tolerated.
PRE_MIGRATION_NULLABLE_COLUMNS = {
    "live_courses": frozenset({"source_last_seen_at"}),
}

MINIMUM_ROWS = {
    "courses": 5_000,
    # Production held 265 retained rows when this boundary was reviewed. A
    # one-row floor would certify catastrophic truncation, so fail below 250.
    "course_sections": 250,
    "schedules": 0,
    "live_catalogue_runs": 1,
    "live_courses": 5_000,
}
MAXIMUM_ROWS = {table: 10_000 for table in TABLE_ORDER}
MAXIMUM_TOTAL_ROWS = 25_000


def _normalise_json_numbers(value):
    """Match PostgreSQL JSON's canonical representation of integral reals."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, list):
        return [_normalise_json_numbers(item) for item in value]
    if isinstance(value, dict):
        return {key: _normalise_json_numbers(item) for key, item in value.items()}
    return value


def canonical_json_bytes(value) -> bytes:
    return json.dumps(
        _normalise_json_numbers(value),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def sha256_hex(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def schema_sha256(path: str | Path) -> str:
    return sha256_hex(Path(path).read_bytes())


def recovery_contract_sha256(root: str | Path) -> str:
    root_path = Path(root)
    manifest = []
    for relative_path in RECOVERY_CONTRACT_PATHS:
        path = root_path / relative_path
        if not path.is_file():
            raise FileNotFoundError(f"Recovery contract file is missing: {relative_path}")
        manifest.append({"path": relative_path, "sha256": sha256_hex(path.read_bytes())})
    return sha256_hex(canonical_json_bytes(manifest))


def rows_sha256(rows: list[dict]) -> str:
    return sha256_hex(canonical_json_bytes(rows))


def package_manifest(
    schema_digest: str,
    recovery_contract_digest: str,
    source_commit: str,
    tables: dict,
) -> dict:
    return {
        "schema_sha256": schema_digest,
        "recovery_contract_sha256": recovery_contract_digest,
        "source_commit": source_commit,
        "tables": {
            table: {
                "row_count": tables[table]["row_count"],
                "payload_sha256": tables[table]["payload_sha256"],
            }
            for table in TABLE_ORDER
        },
    }


def package_sha256(
    schema_digest: str,
    recovery_contract_digest: str,
    source_commit: str,
    tables: dict,
) -> str:
    return sha256_hex(
        canonical_json_bytes(
            package_manifest(schema_digest, recovery_contract_digest, source_commit, tables)
        )
    )
