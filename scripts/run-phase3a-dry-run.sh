#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${PHASE3A_DRYRUN_DB:-nocturne_phase3a_dry_run}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"

echo "==> Base dry-run: $DB_NAME"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DB_NAME\";"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB_NAME\";"

run_sql() {
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$1"
}

echo "==> Bootstrap auth stub"
run_sql "$ROOT/supabase/diagnostics/phase2a_local_pg_bootstrap.sql"

echo "==> Apply all migrations"
for f in $(ls -1 "$MIG_DIR"/*.sql | sort); do
  echo "    - $(basename "$f")"
  if ! run_sql "$f" 2>"$ROOT/supabase/diagnostics/.last_mig_err"; then
    if grep -qiE 'supabase_realtime|publication|duplicate_object|undefined_object' "$ROOT/supabase/diagnostics/.last_mig_err"; then
      echo "      (skip non-bloquant)"
    else
      cat "$ROOT/supabase/diagnostics/.last_mig_err" >&2
      exit 1
    fi
  fi
done

echo "==> Dry-run Phase 3A"
run_sql "$ROOT/supabase/diagnostics/phase3a_dry_run.sql"

echo "==> OK — dry-run Phase 3A terminé sur $DB_NAME"
