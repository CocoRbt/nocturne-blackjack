#!/usr/bin/env bash
# Tests PostgreSQL Phase 2d — validations moteur, RNG, parité.
set -euo pipefail
DB_NAME="${PHASE2D_TEST_DB:-nocturne_phase2d_test}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"

echo "==> Base: $DB_NAME"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DB_NAME\";"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB_NAME\";"
run_sql() { sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$1"; }
echo "==> Bootstrap"
run_sql "$ROOT/supabase/diagnostics/phase2a_local_pg_bootstrap.sql"
echo "==> Migrations"
for f in $(ls -1 "$MIG_DIR"/*.sql | sort); do
  echo "    - $(basename "$f")"
  if ! run_sql "$f" 2>"$ROOT/supabase/diagnostics/.last_mig_err"; then
    if grep -qiE 'supabase_realtime|publication|duplicate_object|undefined_object' \
        "$ROOT/supabase/diagnostics/.last_mig_err"; then
      echo "      (skip non-bloquant)"
    else
      cat "$ROOT/supabase/diagnostics/.last_mig_err" >&2; exit 1
    fi
  fi
done
echo "==> Phase 2d tests"
run_sql "$ROOT/supabase/diagnostics/phase2d_sql_tests.sql"
echo "==> Phase 2c tests (régression)"
PHASE2C_TEST_DB="$DB_NAME" bash "$ROOT/scripts/run-phase2c-pg-test.sh" 2>&1 | \
  grep -E 'PASS|FAIL|ERROR|OK —|NOTICE'
echo "==> OK — Phase 2d terminé sur $DB_NAME"
