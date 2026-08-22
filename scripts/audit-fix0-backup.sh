#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?}"
: "${GITHUB_RUN_ID:?}"
: "${PHASE3B_DB_PASSWORD:?}"
: "${PHASE3B_BACKUP_ENCRYPTION_KEY:?}"

ROOT="${RUNNER_TEMP}/audit-fix0-${GITHUB_RUN_ID}"
PLAIN="${ROOT}/plain"
FORENSIC="${PLAIN}/forensic"
DUMP_DIR="${PLAIN}/dump"
ENCRYPTED="${RUNNER_TEMP}/audit-fix0-encrypted"
VERIFY="${ROOT}/verify"
ARCHIVE="${ROOT}/audit-fix0-${GITHUB_RUN_ID}.tar.gz"
ENC_FILE="${ENCRYPTED}/audit-fix0-${GITHUB_RUN_ID}.tar.gz.enc"
CLIENT_UID="$(id -u)"
CLIENT_GID="$(id -g)"

cleanup_plaintext() {
  if [[ -n "${ROOT:-}" && "$ROOT" == "${RUNNER_TEMP}/audit-fix0-${GITHUB_RUN_ID}" && -d "$ROOT" ]]; then
    find "$ROOT" -type f -delete 2>/dev/null || true
    find "$ROOT" -depth -type d -empty -delete 2>/dev/null || true
  fi
}
trap cleanup_plaintext EXIT

mkdir -p "$FORENSIC" "$DUMP_DIR" "$ENCRYPTED" "$VERIFY"
chmod 700 "$ROOT" "$PLAIN" "$FORENSIC" "$DUMP_DIR" "$ENCRYPTED" "$VERIFY"

export PGPASSWORD="$PHASE3B_DB_PASSWORD"
unset PHASE3B_DB_PASSWORD

docker pull postgres:17 >/dev/null

CONNECTION_RESULT="$(docker run --rm --user "${CLIENT_UID}:${CLIENT_GID}" \
  -e PGPASSWORD -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER \
  -e PGSSLMODE -e PGCONNECT_TIMEOUT postgres:17 \
  psql --no-password --set=ON_ERROR_STOP=1 -tA \
  -c "begin transaction read only; select 1; rollback;")"
test "$(printf '%s' "$CONNECTION_RESULT" | tr -d '[:space:]')" = "BEGIN1ROLLBACK"
echo "DB_CONNECTION=PASS"

FINGERPRINT_SQL="select (select count(*) from public.player_scores)::text || '|' || (select coalesce(sum(balance),0) from public.player_scores)::text || '|' || (select coalesce(sum(vault),0) from public.player_scores)::text || '|' || (select coalesce(sum(peak_balance),0) from public.player_scores)::text || '|' || (select coalesce(sum(games_played),0) from public.player_scores)::text || '|' || (select count(*) from public.wallet_ledger)::text || '|' || (select coalesce(sum(amount),0) from public.wallet_ledger)::text || '|' || (select coalesce(sum(vault_delta),0) from public.wallet_ledger)::text || '|' || (select count(*) from public.game_rounds)::text || '|' || (select count(*) from public.credit_snapshots)::text || '|' || (select coalesce(sum(mini + major + grand),0) from public.circle_jackpots)::text || '|' || (select count(*) from public.circle_jackpot_hits)::text;"
FINGERPRINT="$(docker run --rm --user "${CLIENT_UID}:${CLIENT_GID}" \
  -e PGPASSWORD -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER \
  -e PGSSLMODE -e PGCONNECT_TIMEOUT postgres:17 \
  psql --no-password --set=ON_ERROR_STOP=1 -tA -c "$FINGERPRINT_SQL")"
test -n "$FINGERPRINT"
printf '%s\n' "$FINGERPRINT" > "$FORENSIC/financial_fingerprint.txt"
echo "FINANCIAL_FINGERPRINT=$FINGERPRINT"

cat > "$FORENSIC/export.sql" <<'SQL'
\set ON_ERROR_STOP on
begin transaction read only;
\copy public.player_scores to '/forensic/player_scores.csv' csv header
\copy public.wallet_ledger to '/forensic/wallet_ledger.csv' csv header
\copy public.game_rounds to '/forensic/game_rounds.csv' csv header
\copy public.credit_snapshots to '/forensic/credit_snapshots.csv' csv header
\copy public.circle_jackpots to '/forensic/circle_jackpots.csv' csv header
\copy public.circle_jackpot_hits to '/forensic/circle_jackpot_hits.csv' csv header
\copy public.profiles to '/forensic/profiles.csv' csv header
\copy public.circles to '/forensic/circles.csv' csv header
\copy (select id as profile_id, nickname, circle_id, created_at from public.profiles order by circle_id nulls last, id) to '/forensic/memberships.csv' csv header
\copy (select * from supabase_migrations.schema_migrations order by version) to '/forensic/applied_migrations.csv' csv header
\copy (select n.nspname as schema_name, p.proname, pg_get_function_identity_arguments(p.oid) as arguments, p.prosecdef as security_definer, p.proconfig as configuration, pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') order by 1,2,3) to '/forensic/relevant_functions.csv' csv header
\copy (select routine_schema, routine_name, grantee, privilege_type from information_schema.routine_privileges where routine_schema in ('public','private') order by 1,2,3,4) to '/forensic/routine_grants.csv' csv header
\copy (select table_schema, table_name, grantee, privilege_type from information_schema.table_privileges where table_schema in ('public','private') order by 1,2,3,4) to '/forensic/table_grants.csv' csv header
\copy (select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname in ('public','private') order by 1,2,3) to '/forensic/rls_policies.csv' csv header
\copy (select event_object_schema, event_object_table, trigger_name, action_timing, event_manipulation, action_statement from information_schema.triggers where event_object_schema in ('public','private') order by 1,2,3,5) to '/forensic/triggers.csv' csv header
\copy (select p.*, s.*, l.id as ledger_id, l.idempotency_key, l.op_type, l.amount, l.vault_delta, l.balance_after, l.vault_after, l.game, l.round_id, l.transfer_id, l.metadata, l.created_at as ledger_created_at from public.profiles p left join public.player_scores s on s.profile_id=p.id left join public.wallet_ledger l on l.profile_id=p.id where p.id in ('a30d8791-5fa5-4a7c-89d6-7f459095b0f6','58424855-4d03-40d2-a835-36b93adbea03','2ed60855-a27a-4645-9c43-fb3fc1bb9a53') or lower(p.nickname) like 'kiki%' order by p.id, l.id) to '/forensic/kikiloki_wallet_ledger.csv' csv header
\copy (select r.* from public.game_rounds r where r.profile_id in (select id from public.profiles where id in ('a30d8791-5fa5-4a7c-89d6-7f459095b0f6','58424855-4d03-40d2-a835-36b93adbea03','2ed60855-a27a-4645-9c43-fb3fc1bb9a53') or lower(nickname) like 'kiki%') order by r.created_at, r.id) to '/forensic/kikiloki_rounds.csv' csv header
\copy (select p.*, s.*, l.id as ledger_id, l.idempotency_key, l.op_type, l.amount, l.vault_delta, l.balance_after, l.vault_after, l.game, l.round_id, l.transfer_id, l.metadata, l.created_at as ledger_created_at from public.profiles p left join public.player_scores s on s.profile_id=p.id left join public.wallet_ledger l on l.profile_id=p.id where p.id in ('d1609022-3303-4259-b563-2c38f5b9022d','9596457a-0fd3-4db7-a34c-ce0a3d745463') or lower(p.nickname) like 'lea%' or lower(p.nickname) like 'léa%' order by p.id, l.id) to '/forensic/lea_wallet_ledger.csv' csv header
\copy (select r.* from public.game_rounds r where r.profile_id in (select id from public.profiles where id in ('d1609022-3303-4259-b563-2c38f5b9022d','9596457a-0fd3-4db7-a34c-ce0a3d745463') or lower(nickname) like 'lea%' or lower(nickname) like 'léa%') order by r.created_at, r.id) to '/forensic/lea_rounds.csv' csv header
\copy (select h.* from public.circle_jackpot_hits h where h.profile_id in (select id from public.profiles where id in ('d1609022-3303-4259-b563-2c38f5b9022d','9596457a-0fd3-4db7-a34c-ce0a3d745463') or lower(nickname) like 'lea%' or lower(nickname) like 'léa%') order by h.created_at, h.id) to '/forensic/lea_jackpot_hits.csv' csv header
\copy (select s.* from public.credit_snapshots s where s.profile_id in (select id from public.profiles where lower(nickname) like 'kiki%' or lower(nickname) like 'lea%' or lower(nickname) like 'léa%') order by s.profile_id, s.recorded_at, s.id) to '/forensic/kiki_lea_snapshots.csv' csv header
rollback;
SQL

docker run --rm --user "${CLIENT_UID}:${CLIENT_GID}" \
  -v "$FORENSIC:/forensic" \
  -e PGPASSWORD -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER \
  -e PGSSLMODE -e PGCONNECT_TIMEOUT postgres:17 \
  psql --no-password --set=ON_ERROR_STOP=1 -f /forensic/export.sql
rm -f "$FORENSIC/export.sql"

for FILE in player_scores wallet_ledger game_rounds credit_snapshots circle_jackpots circle_jackpot_hits profiles circles memberships applied_migrations relevant_functions routine_grants table_grants rls_policies triggers kikiloki_wallet_ledger kikiloki_rounds lea_wallet_ledger lea_rounds lea_jackpot_hits kiki_lea_snapshots; do
  test -s "$FORENSIC/${FILE}.csv"
done
(cd "$FORENSIC" && sha256sum *.csv financial_fingerprint.txt > SHA256SUMS)
echo "FORENSIC_EXPORT_READY=YES"
echo "KIKILOKI_FORENSIC_READY=YES"
echo "LEA_FORENSIC_READY=YES"

docker run --rm --user "${CLIENT_UID}:${CLIENT_GID}" \
  -v "$DUMP_DIR:/dump" \
  -e PGPASSWORD -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER \
  -e PGSSLMODE -e PGCONNECT_TIMEOUT postgres:17 \
  pg_dump --format=custom --no-owner --no-acl --no-password \
  --file=/dump/audit_fix0_production.dump
test -s "$DUMP_DIR/audit_fix0_production.dump"
(cd "$DUMP_DIR" && sha256sum audit_fix0_production.dump > audit_fix0_production.dump.sha256)
echo "BACKUP_CREATED=YES"

tar -C "$PLAIN" -czf "$ARCHIVE" dump forensic
PLAIN_SHA="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$ARCHIVE" -out "$ENC_FILE" \
  -pass env:PHASE3B_BACKUP_ENCRYPTION_KEY
test -s "$ENC_FILE"
(cd "$ENCRYPTED" && sha256sum "$(basename "$ENC_FILE")" > "$(basename "$ENC_FILE").sha256")
(cd "$ENCRYPTED" && sha256sum -c "$(basename "$ENC_FILE").sha256")
echo "BACKUP_ENCRYPTED=YES"

rm -f "$ARCHIVE"
find "$PLAIN" -type f -delete

DECRYPTED="$VERIFY/decrypted.tar.gz"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$ENC_FILE" -out "$DECRYPTED" \
  -pass env:PHASE3B_BACKUP_ENCRYPTION_KEY
test "$(sha256sum "$DECRYPTED" | cut -d' ' -f1)" = "$PLAIN_SHA"
mkdir -p "$VERIFY/extracted"
tar -C "$VERIFY/extracted" -xzf "$DECRYPTED"
(cd "$VERIFY/extracted/forensic" && sha256sum -c SHA256SUMS)
(cd "$VERIFY/extracted/dump" && sha256sum -c audit_fix0_production.dump.sha256)

docker run --rm --network host -e PGPASSWORD="$RESTORE_PASSWORD" postgres:17 \
  psql -h 127.0.0.1 -p 5432 -U "$RESTORE_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "drop database if exists nocturne_audit_fix0_restore with (force);" \
  -c "create database nocturne_audit_fix0_restore;"

set +e
docker run --rm --network host \
  -v "$VERIFY/extracted/dump:/dump:ro" \
  -e PGPASSWORD="$RESTORE_PASSWORD" postgres:17 \
  pg_restore -h 127.0.0.1 -p 5432 -U "$RESTORE_USER" \
  -d nocturne_audit_fix0_restore --no-owner --no-acl \
  /dump/audit_fix0_production.dump > "$VERIFY/pg_restore.log" 2>&1
RESTORE_RC=$?
set -e
if [[ "$RESTORE_RC" -ne 0 ]]; then
  UNEXPECTED="$(grep -i 'error:' "$VERIFY/pg_restore.log" | grep -Eiv 'supabase_vault|vault\.secrets' || true)"
  test -z "$UNEXPECTED" || { echo "Unexpected pg_restore error"; exit 1; }
  echo "RESTORE_WARNING=stock PostgreSQL 17 lacks Supabase Vault; all application and financial tables require exact verification"
fi

RESTORED="$(docker run --rm --network host -e PGPASSWORD="$RESTORE_PASSWORD" postgres:17 \
  psql -h 127.0.0.1 -p 5432 -U "$RESTORE_USER" -d nocturne_audit_fix0_restore \
  -v ON_ERROR_STOP=1 -tA -c "$FINGERPRINT_SQL")"
test "$RESTORED" = "$FINGERPRINT"
for TABLE in player_scores wallet_ledger game_rounds credit_snapshots circle_jackpots circle_jackpot_hits profiles circles; do
  EXISTS="$(docker run --rm --network host -e PGPASSWORD="$RESTORE_PASSWORD" postgres:17 \
    psql -h 127.0.0.1 -p 5432 -U "$RESTORE_USER" -d nocturne_audit_fix0_restore \
    -v ON_ERROR_STOP=1 -tA -c "select to_regclass('public.${TABLE}') is not null;")"
  test "$EXISTS" = "t"
done
echo "RESTORE_TEST=PASS"

find "$VERIFY" -type f -delete
if find "$ROOT" -type f \( -name '*.dump' -o -name '*.csv' -o -name '*.txt' -o -name '*.tar.gz' -o -name '*.sql' \) -print -quit | grep -q .; then
  echo "Plaintext remains; refusing artifact upload"
  exit 1
fi

{
  echo "fingerprint=$FINGERPRINT"
  echo "backup_created=yes"
  echo "backup_encrypted=yes"
  echo "restore_test=PASS"
  echo "forensic_ready=yes"
} >> "$GITHUB_OUTPUT"

echo "AUDIT_FIX_0_COMPLETE=YES"
