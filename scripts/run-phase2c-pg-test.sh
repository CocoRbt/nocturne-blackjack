#!/usr/bin/env bash
# Tests PostgreSQL Phase 2c — base locale uniquement. NE PAS pointer la prod.
set -euo pipefail

DB_NAME="${PHASE2C_TEST_DB:-nocturne_phase2c_test}"
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

echo "==> Migrations"
for f in $(ls -1 "$MIG_DIR"/*.sql | sort); do
  echo "    - $(basename "$f")"
  if ! run_sql "$f" 2>"$ROOT/supabase/diagnostics/.last_mig_err"; then
    if grep -qiE 'supabase_realtime|publication|duplicate_object|undefined_object' \
        "$ROOT/supabase/diagnostics/.last_mig_err"; then
      echo "      (skip non-bloquant)"
    else
      cat "$ROOT/supabase/diagnostics/.last_mig_err" >&2
      exit 1
    fi
  fi
done

echo "==> Tests d'intégration Phase 2a"
run_sql "$ROOT/supabase/diagnostics/phase2a_sql_integration_test.sql"

echo "==> Tests d'intégration Phase 2b"
run_sql "$ROOT/supabase/diagnostics/phase2b_sql_integration_test.sql"

echo "==> Tests d'intégration Phase 2c"
run_sql "$ROOT/supabase/diagnostics/phase2c_sql_integration_test.sql"

echo "==> Concurrence : deux mises simultanées solde 100 cr (séquentiel, deux rounds différents)"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<'SQL'
insert into auth.users (id) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') on conflict do nothing;
insert into public.circles (code, name) values ('NOC-RACE2', 'Race2') on conflict (code) do nothing;
insert into public.profiles (id, nickname, circle_id)
select 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Racer2', id from public.circles where code = 'NOC-RACE2'
on conflict (id) do update set nickname = excluded.nickname, circle_id = excluded.circle_id;
SQL
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<'SQL'
begin;
select public.set_test_auth('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
select public.open_account_if_needed();
commit;
SQL

R1='aaaaaaaa-aaaa-4111-8111-111111111111'
R2='bbbbbbbb-bbbb-4222-8222-222222222222'
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL
begin;
select public.set_test_auth('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
select public.crash_start('$R1'::uuid, 8000, null);
commit;
SQL
# Deuxième tentative : solde insuffisant (8000 > 2000 restants)
sudo -u postgres psql -v ON_ERROR_STOP=0 -d "$DB_NAME" <<SQL >"/tmp/p2c-race2.log" 2>&1 || true
begin;
select public.set_test_auth('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
select public.crash_start('$R2'::uuid, 8000, null);
commit;
SQL
cat "/tmp/p2c-race2.log"
BAL=$(sudo -u postgres psql -d "$DB_NAME" -Atc \
  "select balance from public.player_scores where profile_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';")
BETS=$(sudo -u postgres psql -d "$DB_NAME" -Atc \
  "select count(*) from public.wallet_ledger where profile_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' and op_type = 'BET';")
if [[ "$BAL" != "2000" ]]; then
  echo "TEST FAIL concurrence crash: balance=$BAL attendu=2000" >&2; exit 1
fi
if [[ "$BETS" != "1" ]]; then
  echo "TEST FAIL concurrence crash: bets=$BETS attendu=1" >&2; exit 1
fi
echo "==> OK — tests Phase 2c terminés sur $DB_NAME"
