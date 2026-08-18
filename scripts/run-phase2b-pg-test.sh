#!/usr/bin/env bash
# Tests PostgreSQL Phase 2b — base locale uniquement. NE PAS pointer la prod.
set -euo pipefail

DB_NAME="${PHASE2B_TEST_DB:-nocturne_phase2b_test}"
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
    if grep -qiE 'supabase_realtime|publication|duplicate_object|undefined_object' "$ROOT/supabase/diagnostics/.last_mig_err"; then
      echo "      (skip erreur non bloquante realtime)"
    else
      cat "$ROOT/supabase/diagnostics/.last_mig_err" >&2
      exit 1
    fi
  fi
done

echo "==> Tests d'intégration Phase 2b"
run_sql "$ROOT/supabase/diagnostics/phase2b_sql_integration_test.sql"

echo "==> Concurrence : deux mises 80 cr sur solde 100 cr"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<'SQL'
insert into auth.users (id) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc') on conflict do nothing;
insert into public.circles (code, name) values ('NOC-RACE', 'Race') on conflict (code) do nothing;
insert into public.profiles (id, nickname, circle_id)
select 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Racer', id from public.circles where code = 'NOC-RACE'
on conflict (id) do update set nickname = excluded.nickname, circle_id = excluded.circle_id;
SQL

# Compte frais à 10000 via ouverture dans une transaction dédiée
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<'SQL'
begin;
select public.set_test_auth('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
select public.open_account_if_needed();
commit;
SQL

R1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
R2='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'

drop_one() {
  local rid="$1"
  sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "
    begin;
    select public.set_test_auth('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    select public.plinko_drop('$rid'::uuid, 8000, 8, 'low');
    commit;
  " >"/tmp/p2b-race-$rid.log" 2>&1 || true
}

drop_one "$R1" &
drop_one "$R2" &
wait

echo "--- race logs ---"
cat "/tmp/p2b-race-$R1.log"
echo "-----"
cat "/tmp/p2b-race-$R2.log"

sudo -u postgres psql -d "$DB_NAME" -c "
select public.set_test_auth('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
select balance, vault from public.player_scores where profile_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select count(*) as bets from public.wallet_ledger
 where profile_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and op_type = 'BET';
"

BAL=$(sudo -u postgres psql -d "$DB_NAME" -Atc "select balance from public.player_scores where profile_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';")
BETS=$(sudo -u postgres psql -d "$DB_NAME" -Atc "select count(*) from public.wallet_ledger where profile_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and op_type = 'BET';")

if [[ "$BAL" != "2000" ]]; then
  echo "TEST FAIL concurrence: balance=$BAL attendu=2000 (20 crédits)" >&2
  exit 1
fi
if [[ "$BETS" != "1" ]]; then
  echo "TEST FAIL concurrence: bets=$BETS attendu=1" >&2
  exit 1
fi

echo "==> OK — tests PostgreSQL Phase 2b terminés sur $DB_NAME"
