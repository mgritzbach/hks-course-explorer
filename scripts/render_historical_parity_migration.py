"""Render the guarded additive historical-parity data migration."""

import argparse
import hashlib
import json
import re
from pathlib import Path

from historical_parity_reconciliation import (
    load_registry,
    same_id_evaluation_enrichment_target,
)
from load_to_supabase import load_courses, prepare_row, validate_prepared_rows

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "data" / "historical_parity_registry.json"
MIGRATION_PATTERN = re.compile(
    r"^\d{14}_reconcile_historical_catalogue_additively\.sql$"
)


def render_migration(registry, courses):
    courses_by_id = {row["id"]: row for row in courses}
    additive_ids = registry.get("additive_canonical_ids", [])
    if len(additive_ids) != registry["result"]["additive_canonical_only_count"]:
        raise RuntimeError("Additive canonical ID count disagrees with the registry summary")
    missing = sorted(set(additive_ids) - set(courses_by_id))
    if missing:
        raise RuntimeError(f"Reconciled catalogue is missing additive IDs: {missing}")

    rows = [prepare_row(courses_by_id[row_id]) for row_id in additive_ids]
    validate_prepared_rows(rows)
    payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    if "$historical_rows$" in payload:
        raise RuntimeError("Historical payload conflicts with the SQL dollar-quote delimiter")
    payload_sha256 = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    enrichments = []
    for item in registry.get("same_id_canonical_enrichments", []):
        row_id = item["id"]
        if row_id not in courses_by_id:
            raise RuntimeError(f"Reconciled catalogue is missing enrichment ID {row_id}")
        before = item["row"]
        target = prepare_row(courses_by_id[row_id])
        if same_id_evaluation_enrichment_target(before, target) != target:
            raise RuntimeError(
                f"Generated enrichment changes non-evaluation fields for {row_id}"
            )
        enrichments.append({"id": row_id, "before": before, "target": target})
    if len(enrichments) != registry["result"]["same_id_canonical_enrichment_count"]:
        raise RuntimeError("Same-ID enrichment count disagrees with the registry summary")
    enrichment_payload = json.dumps(
        enrichments,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    if "$historical_enrichments$" in enrichment_payload:
        raise RuntimeError("Enrichment payload conflicts with the SQL dollar-quote delimiter")
    enrichment_sha256 = hashlib.sha256(enrichment_payload.encode("utf-8")).hexdigest()
    source_count = registry["source"]["database_row_count"]
    projected_count = registry["result"]["projected_row_count"]

    return f"""-- Preserve every existing observation, enrich one same-ID bidding row
-- with its canonical evaluation, and add only distinct missing observations.
--
-- No ID is changed and no row is deleted or upserted. The single UPDATE is
-- restricted to evaluation fields, requires the exact reviewed full-row
-- preimage, and verifies the exact full-row target before commit.
-- Additive payload SHA-256: {payload_sha256}
-- Enrichment payload SHA-256: {enrichment_sha256}

do $historical_parity$
declare
  expected_before_count constant integer := {source_count};
  expected_update_count constant integer := {len(enrichments)};
  expected_insert_count constant integer := {len(rows)};
  expected_after_count constant integer := {projected_count};
  before_count integer;
  inserted_count integer;
  updated_count integer;
  payload jsonb := $historical_rows${payload}$historical_rows$::jsonb;
  enrichment_payload jsonb := $historical_enrichments${enrichment_payload}$historical_enrichments$::jsonb;
begin
  lock table public.courses in share row exclusive mode;

  select count(*) into before_count from public.courses;
  if before_count <> expected_before_count then
    raise exception
      'Historical parity baseline drifted: expected % rows, found %',
      expected_before_count,
      before_count;
  end if;

  if jsonb_array_length(payload) <> expected_insert_count then
    raise exception 'Historical parity payload count is not %', expected_insert_count;
  end if;

  if jsonb_array_length(enrichment_payload) <> expected_update_count then
    raise exception 'Historical parity enrichment count is not %', expected_update_count;
  end if;

  if (
    select count(distinct item ->> 'id')
    from jsonb_array_elements(enrichment_payload) as enrichment_rows(item)
  ) <> expected_update_count then
    raise exception 'Historical parity enrichment contains missing or duplicate IDs';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(enrichment_payload) as enrichment_rows(item)
    left join public.courses as existing on existing.id = item ->> 'id'
    where existing.id is null or to_jsonb(existing) <> item -> 'before'
  ) then
    raise exception 'Historical parity enrichment preimage drifted';
  end if;

  if (
    select count(distinct item ->> 'id')
    from jsonb_array_elements(payload) as payload_rows(item)
  ) <> expected_insert_count then
    raise exception 'Historical parity payload contains missing or duplicate IDs';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(payload) as payload_rows(item)
    join public.courses as existing on existing.id = item ->> 'id'
  ) then
    raise exception 'Historical parity payload collides with an existing immutable ID';
  end if;

  update public.courses as existing
  set
    has_eval = (item -> 'target' ->> 'has_eval')::boolean,
    n_respondents = (item -> 'target' ->> 'n_respondents')::integer,
    total_n_respondents = (item -> 'target' ->> 'total_n_respondents')::integer,
    metrics_raw = item -> 'target' -> 'metrics_raw',
    metrics_pct = item -> 'target' -> 'metrics_pct',
    instructor_label = item -> 'target' ->> 'instructor_label',
    workload_label = item -> 'target' ->> 'workload_label'
  from jsonb_array_elements(enrichment_payload) as enrichment_rows(item)
  where existing.id = item ->> 'id';

  get diagnostics updated_count = row_count;
  if updated_count <> expected_update_count then
    raise exception
      'Historical parity enrichment updated % rows instead of %',
      updated_count,
      expected_update_count;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(enrichment_payload) as enrichment_rows(item)
    join public.courses as existing on existing.id = item ->> 'id'
    where to_jsonb(existing) <> item -> 'target'
  ) then
    raise exception 'Historical parity enrichment target differs after update';
  end if;

  insert into public.courses
  select (jsonb_populate_record(null::public.courses, item)).*
  from jsonb_array_elements(payload) as payload_rows(item);

  get diagnostics inserted_count = row_count;
  if inserted_count <> expected_insert_count then
    raise exception
      'Historical parity insert wrote % rows instead of %',
      inserted_count,
      expected_insert_count;
  end if;

  if (select count(*) from public.courses) <> expected_after_count then
    raise exception 'Historical parity postcondition did not reach % rows', expected_after_count;
  end if;
end
$historical_parity$;
"""


def main(argv=None):
    parser = argparse.ArgumentParser(description="Render the reviewed historical parity migration.")
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    destination = Path(args.output).resolve()
    if destination.parent != (ROOT / "supabase" / "migrations").resolve():
        raise SystemExit("Migration output must be inside supabase/migrations.")
    if not MIGRATION_PATTERN.fullmatch(destination.name):
        raise SystemExit("Migration filename does not match the reviewed historical parity name.")

    destination.write_text(
        render_migration(load_registry(REGISTRY), load_courses()),
        encoding="utf-8",
    )
    print(f"Rendered {destination.name} from the reviewed reconciliation registry.")


if __name__ == "__main__":
    main()
