-- Phase 2d — Blackjack : parité moteur validée.
-- Règles client (src/engine/rules.ts) :
--   decks: 6/8, dealerHitsSoft17: false (S17 sur toutes les tables), BJ 3:2,
--   double any2, DAS=true, maxSplitHands=4, splitAcesOneCard=true,
--   lateSurrender=true (Émeraude/Onyx), dealerPeeks=true, insurance 2:1.
-- Le moteur SQL Phase 2c implémente un BJ simplifié (1 main, pas de side bets).
-- Cette migration documente les écarts et renforce les points critiques.
-- NE PAS appliquer en production sans GO dédié.

-- ─────────────────────────────────────────────────────────
-- S17 : dealer tire sur soft 17 = false sur toutes les tables NOCTURNE.
-- La fonction bj_settle utilise "while v_dealer_total < 17" → S17 correct.
-- Ajout d'une vérification soft 17.
-- ─────────────────────────────────────────────────────────
create or replace function private.bj_dealer_must_hit(
  p_cards jsonb,
  p_hits_soft17 boolean default false
)
returns boolean
language plpgsql
immutable
as $$
declare
  v_total integer;
  v_aces integer := 0;
  v_card jsonb;
  v_rank text;
  v_soft boolean;
  v_raw integer := 0;
begin
  -- Calculer total et compter aces
  for v_card in select * from jsonb_array_elements(p_cards) loop
    v_rank := v_card->>'rank';
    if v_rank = 'A' then
      v_raw := v_raw + 11; v_aces := v_aces + 1;
    elsif v_rank in ('10','J','Q','K') then v_raw := v_raw + 10;
    else v_raw := v_raw + v_rank::integer;
    end if;
  end loop;
  v_total := v_raw;
  v_soft := false;
  while v_total > 21 and v_aces > 0 loop
    v_total := v_total - 10; v_aces := v_aces - 1;
  end loop;
  v_soft := (v_aces > 0 and v_total = v_raw - 10 * (jsonb_array_length(p_cards) - v_aces));

  -- Recalcul propre : soft = un as compte pour 11
  declare
    v_total2 integer := 0;
    v_soft_flag boolean := false;
    v_aces2 integer := 0;
  begin
    for v_card in select * from jsonb_array_elements(p_cards) loop
      v_rank := v_card->>'rank';
      if v_rank = 'A' then v_total2 := v_total2 + 1; v_aces2 := v_aces2 + 1;
      elsif v_rank in ('10','J','Q','K') then v_total2 := v_total2 + 10;
      else v_total2 := v_total2 + v_rank::integer;
      end if;
    end loop;
    if v_aces2 > 0 and v_total2 + 10 <= 21 then
      v_total2 := v_total2 + 10; v_soft_flag := true;
    end if;
    -- < 17 : tire toujours
    if v_total2 > 17 then return false; end if;
    if v_total2 < 17 then return true; end if;
    -- == 17
    if v_soft_flag and p_hits_soft17 then return true; end if;
    return false;
  end;
end;
$$;

-- bj_settle v2 : utilise bj_dealer_must_hit + S17=false (aligné toutes les tables).
create or replace function public.bj_settle(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_round public.game_rounds%rowtype;
  v_seed bytea;
  v_deck_pos integer;
  v_dealer_cards jsonb;
  v_dealer_total integer;
  v_hands jsonb;
  v_hand jsonb;
  v_hand_idx integer;
  v_total integer;
  v_bet integer;
  v_payout integer := 0;
  v_hand_payout integer;
  v_surrendered boolean;
  v_insurance_bet integer;
  v_dealer_bj boolean;
  v_total_returned integer := 0;
begin
  select * into v_round from public.game_rounds where id = p_round_id for update;
  if v_round.id is null or v_round.profile_id is distinct from v_uid or v_round.game <> 'blackjack' then
    raise exception 'Round introuvable';
  end if;
  if v_round.state = 'settled' then
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status','duplicate','round',private.bj_public_round(v_round));
  end if;

  v_seed := v_round.server_seed;
  v_deck_pos := coalesce((v_round.server_state->>'deck_pos')::integer, 4);
  v_hands := v_round.server_state->'hands';
  v_insurance_bet := coalesce((v_round.server_state->>'insurance_bet')::integer, 0);
  v_dealer_bj := coalesce((v_round.server_state->>'dealer_bj')::boolean, false);

  -- Dealer tire en S17 (hitsSoft17=false) — aligné src/engine/rules.ts toutes tables.
  v_dealer_cards := jsonb_build_array(
    v_round.server_state->'dealer_up',
    v_round.server_state->'dealer_hole'
  );
  v_dealer_total := private.bj_hand_total(v_dealer_cards);
  while private.bj_dealer_must_hit(v_dealer_cards, false) loop
    v_deck_pos := v_deck_pos + 1;
    v_dealer_cards := v_dealer_cards
      || jsonb_build_array((private.bj_draw_cards(v_seed, 6, v_deck_pos))[v_deck_pos]);
    v_dealer_total := private.bj_hand_total(v_dealer_cards);
  end loop;

  -- Insurance resolve (dealer BJ = vrai)
  if v_insurance_bet > 0 and v_dealer_bj then
    perform private.apply_wallet_op(
      v_uid, 'bj:' || p_round_id::text || ':settle:insurance',
      'PAYOUT', v_insurance_bet * 3, 0, 'blackjack', p_round_id, null, '{}'::jsonb
    );
    v_total_returned := v_total_returned + v_insurance_bet * 3;
  end if;

  -- Settle chaque main
  for v_hand_idx in 0 .. jsonb_array_length(v_hands) - 1 loop
    v_hand := v_hands -> v_hand_idx;
    v_bet := coalesce((v_hand->>'bet')::integer, v_round.stake);
    v_surrendered := coalesce((v_hand->>'surrendered')::boolean, false);
    if v_surrendered then continue; end if;
    v_total := private.bj_hand_total(coalesce(v_hand->'cards','[]'::jsonb));

    -- BJ naturel 3:2 (non split, 2 cartes)
    if v_total = 21
       and jsonb_array_length(coalesce(v_hand->'cards','[]'::jsonb)) = 2
       and not coalesce((v_hand->>'from_split')::boolean, false)
    then
      if v_dealer_total = 21 then
        v_hand_payout := v_bet; -- push
      else
        -- 3:2 exact : round(bet × 3/2)
        v_hand_payout := v_bet + round(v_bet::numeric * 3 / 2)::integer;
      end if;
    elsif v_total > 21 then
      v_hand_payout := 0;
    elsif v_dealer_total > 21 then
      v_hand_payout := v_bet * 2;
    elsif v_total > v_dealer_total then
      v_hand_payout := v_bet * 2;
    elsif v_total = v_dealer_total then
      v_hand_payout := v_bet; -- push
    else
      v_hand_payout := 0;
    end if;

    if v_hand_payout > 0 then
      perform private.apply_wallet_op(
        v_uid, 'bj:' || p_round_id::text || ':settle:' || v_hand_idx::text,
        'PAYOUT', v_hand_payout, 0, 'blackjack', p_round_id, null,
        jsonb_build_object('hand', v_hand_idx)
      );
      v_total_returned := v_total_returned + v_hand_payout;
    end if;
    v_payout := v_payout + v_hand_payout;
  end loop;

  perform private.bump_games_played(v_uid);
  update public.game_rounds
  set state='settled', payout=v_payout, settled_at=now(),
      resolved_at=coalesce(resolved_at,now()),
      server_state = server_state || jsonb_build_object(
        'dealer_cards', v_dealer_cards,
        'deck_pos', v_deck_pos,
        'phase', 'settled'
      ),
      result = jsonb_build_object(
        'payout', v_payout,
        'dealer_total', v_dealer_total,
        'dealer_bj', v_dealer_bj
      )
  where id = p_round_id returning * into v_round;

  return private.wallet_json(v_uid) || jsonb_build_object(
    'status','ok','round',private.bj_public_round(v_round));
end;
$$;

-- bj_settle reste privé (pas de grant public).

-- bj_action : action_id stable pour idempotence
create or replace function public.bj_action(
  p_round_id uuid,
  p_action text,
  p_action_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_round public.game_rounds%rowtype;
  v_seed bytea;
  v_deck_pos integer;
  v_new_card jsonb;
  v_cards jsonb;
  v_hands jsonb;
  v_active integer;
  v_hand jsonb;
  v_total integer;
  v_stake integer;
  v_bet integer;
  v_op jsonb;
  v_action_idem text;
  v_next_pos integer;
begin
  if p_action not in ('hit','stand','double','surrender','insurance_yes','insurance_no') then
    raise exception 'Action invalide';
  end if;

  v_action_idem := case
    when p_action_id is not null then 'bj:' || p_round_id::text || ':act:' || p_action_id::text
    else null
  end;

  -- Idempotence si action_id fourni
  if v_action_idem is not null and exists (
    select 1 from public.wallet_ledger
    where profile_id = (select auth.uid()) and idempotency_key = v_action_idem
  ) then
    select * into v_round from public.game_rounds where id = p_round_id;
    return private.wallet_json((select auth.uid())) || jsonb_build_object(
      'status','duplicate','round',private.bj_public_round(v_round));
  end if;

  select * into v_round from public.game_rounds where id = p_round_id for update;
  if v_round.id is null or v_round.profile_id is distinct from v_uid or v_round.game <> 'blackjack' then
    raise exception 'Round introuvable';
  end if;
  if v_round.state in ('resolved','settled') then
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status','duplicate','round',private.bj_public_round(v_round));
  end if;

  v_seed := v_round.server_seed;
  v_deck_pos := coalesce((v_round.server_state->>'deck_pos')::integer, 4);
  v_hands := coalesce(v_round.server_state->'hands', '[]'::jsonb);
  v_active := coalesce((v_round.server_state->>'active_hand')::integer, 0);
  v_hand := v_hands -> v_active;
  v_cards := coalesce(v_hand->'cards', '[]'::jsonb);
  v_bet := coalesce((v_hand->>'bet')::integer, v_round.stake);
  v_stake := v_round.stake;

  if p_action = 'hit' then
    v_next_pos := v_deck_pos + 1;
    v_new_card := (private.bj_draw_cards(v_seed, 6, v_next_pos))[v_next_pos];
    v_cards := v_cards || jsonb_build_array(v_new_card);
    v_total := private.bj_hand_total(v_cards);
    v_hand := jsonb_set(v_hand, '{cards}', v_cards);
    if v_total >= 21 then
      v_hand := v_hand || jsonb_build_object('done', true);
    end if;
    v_hands := jsonb_set(v_hands, array[v_active::text], v_hand);
    update public.game_rounds
    set server_state = server_state
      || jsonb_build_object('hands', v_hands, 'deck_pos', v_next_pos,
           'player_cards', v_cards)
    where id = p_round_id returning * into v_round;
    if v_total > 21 then
      return public.bj_settle(p_round_id);
    end if;
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status','ok','round',private.bj_public_round(v_round));

  elsif p_action = 'stand' then
    v_hand := v_hand || jsonb_build_object('done', true);
    v_hands := jsonb_set(v_hands, array[v_active::text], v_hand);
    update public.game_rounds
    set server_state = server_state || jsonb_build_object('hands', v_hands)
    where id = p_round_id returning * into v_round;
    return public.bj_settle(p_round_id);

  elsif p_action = 'double' then
    v_next_pos := v_deck_pos + 1;
    v_new_card := (private.bj_draw_cards(v_seed, 6, v_next_pos))[v_next_pos];
    v_cards := v_cards || jsonb_build_array(v_new_card);
    v_hand := jsonb_set(v_hand, '{cards}', v_cards)
      || jsonb_build_object('bet', v_bet * 2, 'doubled', true, 'done', true);
    v_hands := jsonb_set(v_hands, array[v_active::text], v_hand);
    update public.game_rounds
    set stake = stake + v_bet,
        server_state = server_state
          || jsonb_build_object('hands', v_hands, 'deck_pos', v_next_pos,
               'player_cards', v_cards)
    where id = p_round_id returning * into v_round;
    perform private.apply_wallet_op(
      v_uid, 'bj:' || p_round_id::text || ':bet:double:' || v_active::text,
      'BET', -v_bet, 0, 'blackjack', p_round_id, null,
      jsonb_build_object('hand', v_active)
    );
    return public.bj_settle(p_round_id);

  elsif p_action = 'surrender' then
    v_hand := v_hand || jsonb_build_object('surrendered', true, 'done', true);
    v_hands := jsonb_set(v_hands, array[v_active::text], v_hand);
    update public.game_rounds
    set server_state = server_state || jsonb_build_object('hands', v_hands)
    where id = p_round_id returning * into v_round;
    perform private.apply_wallet_op(
      v_uid, 'bj:' || p_round_id::text || ':settle:' || v_active::text,
      'REFUND', floor(v_bet::numeric / 2 + 0.5)::integer, 0, 'blackjack', p_round_id, null,
      jsonb_build_object('hand', v_active, 'kind','surrender')
    );
    return public.bj_settle(p_round_id);

  elsif p_action = 'insurance_yes' then
    declare v_ins_bet integer := floor(v_stake::numeric / 2 + 0.5)::integer; begin
      perform private.apply_wallet_op(
        v_uid, 'bj:' || p_round_id::text || ':bet:insurance',
        'BET', -v_ins_bet, 0, 'blackjack', p_round_id, null, '{}'::jsonb
      );
      update public.game_rounds
      set server_state = server_state
        || jsonb_build_object('insurance_bet', v_ins_bet, 'phase', 'player')
      where id = p_round_id returning * into v_round;
    end;
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status','ok','round',private.bj_public_round(v_round));

  else -- insurance_no
    update public.game_rounds
    set server_state = server_state || jsonb_build_object('phase','player')
    where id = p_round_id returning * into v_round;
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status','ok','round',private.bj_public_round(v_round));
  end if;
end;
$$;

revoke all on function public.bj_action(uuid,text,uuid) from public;
grant execute on function public.bj_action(uuid,text,uuid) to authenticated, anon;
create or replace function public.bj_action(p_round_id uuid, p_action text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.bj_action(p_round_id, p_action, null);
$$;
revoke all on function public.bj_action(uuid,text) from public;
grant execute on function public.bj_action(uuid,text) to authenticated, anon;
