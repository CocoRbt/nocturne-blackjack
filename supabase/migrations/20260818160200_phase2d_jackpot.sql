-- Phase 2d — Jackpot : sécurisation claim + round_id obligatoire.
-- claim_stampede_jackpot existant : crédite player_scores directement (legacy).
-- Nouveau : claim_jackpot_ledger lié au round_id slots → idempotent + ledger.
-- NE PAS appliquer en production sans GO dédié.

-- Colonne idempotency_claim sur circle_jackpot_hits
alter table public.circle_jackpot_hits
  add column if not exists idempotency_key text,
  add column if not exists round_id uuid;

create unique index if not exists circle_jackpot_hits_idempotency
  on public.circle_jackpot_hits (idempotency_key)
  where idempotency_key is not null;

-- claim_jackpot_ledger : remplace claim_stampede_jackpot pour les profils ledger.
-- Refuse si :
--   * round_id non trouvé ou pas settl'd
--   * jackpot_tier du round ne correspond pas au tier demandé
--   * claim déjà fait pour ce round
--   * pot vide
create or replace function public.claim_jackpot_ledger(
  p_tier text,
  p_round_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_circle uuid;
  v_row public.circle_jackpots%rowtype;
  v_round public.game_rounds%rowtype;
  v_tier text;
  v_amount integer;
  v_seed integer;
  v_idem_key text;
begin
  v_tier := lower(trim(coalesce(p_tier, '')));
  if v_tier not in ('mini','major','grand') then raise exception 'Palier invalide'; end if;
  if p_round_id is null then raise exception 'round_id requis'; end if;

  -- Le round doit appartenir au joueur, être un spin Slots settled, et avoir ce jackpot_tier.
  select * into v_round from public.game_rounds
  where id = p_round_id and profile_id = v_uid and game = 'slots';
  if v_round.id is null then raise exception 'Round introuvable'; end if;
  if v_round.state <> 'settled' then raise exception 'Round pas encore settled'; end if;
  if coalesce(v_round.server_state->>'jackpot_tier', v_round.result->>'jackpot_tier', '') <> v_tier then
    raise exception 'Ce round ne déclenchait pas ce palier jackpot';
  end if;

  v_idem_key := 'jp:' || p_round_id::text;

  -- Idempotence : déjà réclamé pour ce round ?
  if exists (
    select 1 from public.circle_jackpot_hits where idempotency_key = v_idem_key
  ) then
    -- Retourner le résultat existant.
    declare
      v_hit public.circle_jackpot_hits%rowtype;
    begin
      select * into v_hit from public.circle_jackpot_hits where idempotency_key = v_idem_key;
      select circle_id into v_circle from public.profiles where id = v_uid;
      select * into v_row from public.circle_jackpots where circle_id = v_circle;
      return private.wallet_json(v_uid) || jsonb_build_object(
        'status','duplicate','tier',v_tier,'amount',v_hit.amount,
        'mini',v_row.mini,'major',v_row.major,'grand',v_row.grand);
    end;
  end if;

  select circle_id into v_circle from public.profiles where id = v_uid;
  v_row := public.ensure_circle_jackpots(v_circle);

  -- Lock pot
  select * into v_row from public.circle_jackpots where circle_id = v_circle for update;

  v_amount := case v_tier
    when 'mini' then v_row.mini
    when 'major' then v_row.major
    else v_row.grand
  end;
  v_seed := case v_tier
    when 'mini' then 100000
    when 'major' then 500000
    else 1500000
  end;
  if v_amount <= 0 then raise exception 'Jackpot vide'; end if;

  -- Reset pot
  update public.circle_jackpots
  set
    mini = case when v_tier='mini' then v_seed else mini end,
    major = case when v_tier='major' then v_seed else major end,
    grand = case when v_tier='grand' then v_seed else grand end,
    updated_at = now()
  where circle_id = v_circle
  returning * into v_row;

  insert into public.circle_jackpot_hits (circle_id, profile_id, tier, amount, bet, idempotency_key, round_id)
  values (v_circle, v_uid, v_tier, v_amount, v_round.stake, v_idem_key, p_round_id);

  -- Créditer via ledger
  perform private.apply_wallet_op(
    v_uid, 'jp:claim:' || p_round_id::text,
    'PAYOUT', v_amount, 0, 'slots', p_round_id, null,
    jsonb_build_object('jackpot_tier', v_tier, 'amount', v_amount)
  );

  return private.wallet_json(v_uid) || jsonb_build_object(
    'status','ok','tier',v_tier,'amount',v_amount,
    'mini',v_row.mini,'major',v_row.major,'grand',v_row.grand);
end;
$$;

revoke all on function public.claim_jackpot_ledger(text, uuid) from public;
grant execute on function public.claim_jackpot_ledger(text, uuid) to authenticated, anon;
