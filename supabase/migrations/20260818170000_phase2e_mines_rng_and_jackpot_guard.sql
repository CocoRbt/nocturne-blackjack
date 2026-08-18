-- Phase 2e — Mines RNG uniforme + garde-fou jackpot legacy pour profils ledger.
-- NE PAS appliquer en production sans GO dédié.

-- 1) Mines : Fisher-Yates uniforme avec rejection sampling.
create or replace function private.mines_place(p_mines integer, p_seed bytea)
returns integer[]
language plpgsql
immutable
as $$
declare
  v_idx integer[] := array[
    0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24
  ];
  v_i integer;
  v_j integer;
  v_tmp integer;
  v_out integer[] := '{}';
  v_mines integer;
  v_threshold bigint;
  v_val bigint;
  v_offset integer := 0;
begin
  v_mines := least(24, greatest(1, p_mines));
  for v_i in reverse 24 .. 1 loop
    v_threshold := 256 - (256 % (v_i + 1));
    loop
      v_val := get_byte(p_seed, v_offset % octet_length(p_seed));
      v_offset := v_offset + 1;
      exit when v_val < v_threshold;
    end loop;
    v_j := (v_val % (v_i + 1))::integer;
    v_tmp := v_idx[v_i + 1];
    v_idx[v_i + 1] := v_idx[v_j + 1];
    v_idx[v_j + 1] := v_tmp;
  end loop;
  for v_i in 1 .. v_mines loop
    v_out := v_out || v_idx[v_i];
  end loop;
  return v_out;
end;
$$;

-- 2) Jackpot legacy : interdit pour les profils déjà migrés ledger.
create or replace function public.claim_stampede_jackpot(
  p_tier text,
  p_bet integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_circle uuid;
  v_row public.circle_jackpots%rowtype;
  v_score public.player_scores%rowtype;
  v_tier text;
  v_bet integer;
  v_amount integer;
  v_seed integer;
  v_max_claim constant integer := 5_000_000;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  -- Profils ledger : utiliser exclusivement claim_jackpot_ledger(round_id).
  if exists (select 1 from public.wallet_ledger where profile_id = v_uid) then
    raise exception 'Profil ledger : utiliser claim_jackpot_ledger avec le round du spin';
  end if;

  v_tier := lower(trim(both from coalesce(p_tier, '')));
  if v_tier not in ('mini', 'major', 'grand') then
    raise exception 'Palier invalide';
  end if;

  v_bet := coalesce(p_bet, 0);
  if v_bet < 100 or v_bet > 5_000_000 then
    raise exception 'Mise invalide';
  end if;

  select circle_id into v_circle from public.profiles where id = v_uid;
  if v_circle is null then
    raise exception 'Rejoins un cercle d''abord';
  end if;

  v_row := public.ensure_circle_jackpots(v_circle);

  if v_tier = 'mini' then
    v_amount := v_row.mini;
    v_seed := 100000;
  elsif v_tier = 'major' then
    v_amount := v_row.major;
    v_seed := 500000;
  else
    v_amount := v_row.grand;
    v_seed := 1500000;
  end if;

  if v_amount <= 0 then
    raise exception 'Jackpot vide';
  end if;
  if v_amount > v_max_claim then
    v_amount := v_max_claim;
  end if;

  if v_tier = 'mini' then
    update public.circle_jackpots
    set mini = v_seed, updated_at = now()
    where circle_id = v_circle;
  elsif v_tier = 'major' then
    update public.circle_jackpots
    set major = v_seed, updated_at = now()
    where circle_id = v_circle;
  else
    update public.circle_jackpots
    set grand = v_seed, updated_at = now()
    where circle_id = v_circle;
  end if;

  select * into v_score from public.player_scores where profile_id = v_uid for update;
  if v_score.profile_id is null then
    insert into public.player_scores (profile_id, balance, peak_balance, vault, updated_at)
    values (v_uid, v_amount, v_amount, 0, now())
    returning * into v_score;
  else
    update public.player_scores
    set
      balance = balance + v_amount,
      peak_balance = greatest(peak_balance, balance + v_amount),
      updated_at = now()
    where profile_id = v_uid
    returning * into v_score;
  end if;

  insert into public.credit_snapshots (profile_id, balance)
  values (v_uid, v_score.balance);

  insert into public.circle_jackpot_hits (circle_id, profile_id, tier, amount, bet)
  values (v_circle, v_uid, v_tier, v_amount, v_bet);

  select * into v_row from public.circle_jackpots where circle_id = v_circle;

  return jsonb_build_object(
    'ok', true,
    'tier', v_tier,
    'amount', v_amount,
    'balance', v_score.balance,
    'peak_balance', v_score.peak_balance,
    'mini', v_row.mini,
    'major', v_row.major,
    'grand', v_row.grand
  );
end;
$$;

revoke all on function public.claim_stampede_jackpot(text, integer) from public;
grant execute on function public.claim_stampede_jackpot(text, integer) to authenticated, anon;
