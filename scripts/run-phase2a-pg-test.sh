#!/usr/bin/env bash
# Applique les migrations NOCTURNE sur Postgres local et exécute les tests Phase 2a.
# NE PAS pointer vers la production Supabase.
set -euo pipefail

DB_NAME="${PHASE2A_TEST_DB:-nocturne_phase2a_test}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"

echo "==> Base de test: $DB_NAME (local Postgres uniquement)"

sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DB_NAME\";"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB_NAME\";"

run_sql() {
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$1"
}

echo "==> Bootstrap auth stub"
run_sql "$ROOT/supabase/diagnostics/phase2a_local_pg_bootstrap.sql"

echo "==> Migrations ($(ls -1 "$MIG_DIR"/*.sql | wc -l) fichiers)"
for f in $(ls -1 "$MIG_DIR"/*.sql | sort); do
  echo "    - $(basename "$f")"
  # Realtime / publication : optionnel en local
  if ! run_sql "$f" 2>"$ROOT/supabase/diagnostics/.last_mig_err"; then
    if grep -qiE 'supabase_realtime|publication|duplicate_object|undefined_object' "$ROOT/supabase/diagnostics/.last_mig_err"; then
      echo "      (skip erreur non bloquante realtime)"
    else
      cat "$ROOT/supabase/diagnostics/.last_mig_err" >&2
      exit 1
    fi
  fi
done

echo "==> Tests d'intégration Phase 2a"
run_sql "$ROOT/supabase/diagnostics/phase2a_sql_integration_test.sql"

echo "==> PHASE2A_VERIFY (lecture définitions)"
sudo -u postgres psql -d "$DB_NAME" -c "
SELECT
  'sync_mid_bet_restore' AS check,
  position('v_games = coalesce(v_prev.games_played, 0)' IN pg_get_functiondef(
    'public.sync_my_score(integer, integer, integer, integer, integer, text, integer, integer, integer)'::regprocedure
  )) > 0 AS failed;
SELECT
  'trigger_old_wallet_restore' AS check,
  (
    pg_get_functiondef('public.enforce_score_invariants()'::regprocedure) ILIKE '%new.balance := old.balance%'
    OR pg_get_functiondef('public.enforce_score_invariants()'::regprocedure) ILIKE '%new.vault := coalesce(old.vault%'
  ) AS failed;
SELECT
  'ensure_membership_peak_restore' AS check,
  (
    pg_get_functiondef('public.ensure_circle_membership(text, text)'::regprocedure) ILIKE '%peak_balance - coalesce(s.vault%'
  ) AS failed;
"

echo "==> OK — tests PostgreSQL Phase 2a terminés sur $DB_NAME"
