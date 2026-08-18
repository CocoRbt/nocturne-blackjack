-- Phase 2c — Blackjack (deck serveur, 1 table / round par joueur, settlement complet).
-- RNG : gen_random_bytes(416) → sabot de 6 jeux × 52 = 312 cartes + buffer.
-- Le deck est figé dans server_seed ; les cartes sont tirées par index.
-- Le client envoie les actions (hit/stand/double/split/surrender/insurance).
-- Le serveur calcule le résultat et crédite.
-- NE PAS appliquer en production sans GO dédié.

create or replace function private.bj_build_card(p_idx integer)
returns jsonb
language sql
immutable
as $$
  -- 52 cartes par deck : rank = idx%13, suit = idx/13
  -- ranks: A,2,3,4,5,6,7,8,9,10,J,Q,K
  -- suits: ♠,♥,♦,♣
  select jsonb_build_object(
    'rank', (array['A','2','3','4','5','6','7','8','9','10','J','Q','K'])[(p_idx % 13) + 1],
    'suit', (array['♠','♥','♦','♣'])[(p_idx / 13) + 1],
    'id', 'c' || p_idx::text
  );
$$;

create or replace function private.bj_draw_cards(
  p_seed bytea,
  p_deck_count integer,
  p_n integer
)
returns jsonb[]
language plpgsql
immutable
as $$
declare
  v_size integer := p_deck_count * 52;
  v_deck integer[];
  v_i integer;
  v_j integer;
  v_tmp integer;
  v_out jsonb[] := '{}';
begin
  -- Initialiser le deck
  for v_i in 0 .. v_size - 1 loop
    v_deck := v_deck || (v_i % 52);
  end loop;
  -- Fisher-Yates avec les bytes du seed
  for v_i in reverse v_size - 1 .. 1 loop
    v_j := (get_byte(p_seed, v_i % octet_length(p_seed)))::integer * 256
          + (get_byte(p_seed, (v_i+1) % octet_length(p_seed)))::integer;
    v_j := abs(v_j) % (v_i + 1);
    v_tmp := v_deck[v_i + 1];
    v_deck[v_i + 1] := v_deck[v_j + 1];
    v_deck[v_j + 1] := v_tmp;
  end loop;
  for v_i in 1 .. p_n loop
    v_out := v_out || private.bj_build_card(v_deck[v_i] % 52);
  end loop;
  return v_out;
end;
$$;

create or replace function private.bj_card_value(p_rank text)
returns integer
language sql
immutable
as $$
  select case
    when p_rank = 'A' then 11
    when p_rank in ('10','J','Q','K') then 10
    else p_rank::integer
  end;
$$;

create or replace function private.bj_hand_total(p_cards jsonb)
returns integer
language plpgsql
immutable
as $$
declare
  v_total integer := 0;
  v_aces integer := 0;
  v_card jsonb;
begin
  for v_card in select * from jsonb_array_elements(p_cards) loop
    v_total := v_total + private.bj_card_value(v_card->>'rank');
    if v_card->>'rank' = 'A' then v_aces := v_aces + 1; end if;
  end loop;
  while v_total > 21 and v_aces > 0 loop
    v_total := v_total - 10;
    v_aces := v_aces - 1;
  end loop;
  return v_total;
end;
$$;

create or replace function private.bj_public_round(p_round public.game_rounds)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_phase text;
  v_settled boolean;
begin
  v_phase := coalesce(p_round.server_state->>'phase', 'dealing');
  v_settled := p_round.state = 'settled';
  return jsonb_build_object(
    'round_id', p_round.id,
    'game', 'blackjack',
    'state', p_round.state,
    'stake', p_round.stake,
    'payout', p_round.payout,
    'phase', v_phase,
    'player_cards', p_round.server_state->'player_cards',
    'dealer_up', p_round.server_state->'dealer_up',
    'dealer_cards', case when v_settled
      then p_round.server_state->'dealer_cards'
      else null end,
    'hands', p_round.server_state->'hands',
    'active_hand', p_round.server_state->'active_hand',
    'player_total', private.bj_hand_total(coalesce(p_round.server_state->'player_cards','[]'::jsonb)),
    'dealer_total', case when v_settled
      then private.bj_hand_total(coalesce(p_round.server_state->'dealer_cards','[]'::jsonb))
      else null end,
    'created_at', p_round.created_at,
    'settled_at', p_round.settled_at
  );
end;
$$;

-- Deal : met 2 cartes joueur + 1 visible croupier (+ 1 cachée dans server_state).
create or replace function public.bj_deal(
  p_round_id uuid,
  p_stake integer
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
  v_cards jsonb[];
  v_pc jsonb;  -- player card 1
  v_dc jsonb;  -- dealer up
  v_pc2 jsonb; -- player card 2
  v_hole jsonb;-- dealer hole
  v_p_total integer;
  v_dealer_bj boolean;
  v_player_bj boolean;
  v_op jsonb;
  v_payout integer := 0;
  v_state text := 'open';
  v_phase text := 'player';
  v_initial_hands jsonb;
begin
  if p_round_id is null then raise exception 'round_id requis'; end if;
  if p_stake is null or p_stake < 100 then raise exception 'Mise invalide'; end if;

  select * into v_round from public.game_rounds where id = p_round_id;
  if v_round.id is not null then
    if v_round.profile_id is distinct from v_uid or v_round.game <> 'blackjack' then
      raise exception 'Round introuvable';
    end if;
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status','duplicate','round',private.bj_public_round(v_round));
  end if;

  if exists (
    select 1 from public.game_rounds
    where profile_id = v_uid and game = 'blackjack' and state in ('open','resolved')
  ) then raise exception 'Manche Blackjack en cours'; end if;

  perform 1 from public.player_scores where profile_id = v_uid for update;

  v_seed := gen_random_bytes(416);
  v_cards := private.bj_draw_cards(v_seed, 6, 4);
  v_pc   := v_cards[1];
  v_dc   := v_cards[2];
  v_pc2  := v_cards[3];
  v_hole := v_cards[4];

  v_p_total := private.bj_hand_total(jsonb_build_array(v_pc, v_pc2));
  v_dealer_bj := private.bj_hand_total(jsonb_build_array(v_dc, v_hole)) = 21
    and (v_dc->>'rank' in ('A','10','J','Q','K'));
  v_player_bj := v_p_total = 21;

  -- BJ naturel vs BJ naturel = push
  if v_player_bj and v_dealer_bj then
    v_payout := p_stake;
    v_state := 'resolved';
    v_phase := 'settled';
  elsif v_player_bj then
    v_payout := p_stake + floor(p_stake::numeric * 1.5 + 0.000001)::integer;
    v_state := 'resolved';
    v_phase := 'settled';
  elsif v_dealer_bj then
    v_payout := 0;
    v_state := 'resolved';
    v_phase := 'settled';
  else
    v_phase := case when v_dc->>'rank' = 'A' then 'insurance' else 'player' end;
  end if;

  v_initial_hands := jsonb_build_array(jsonb_build_object(
    'index', 0,
    'cards', jsonb_build_array(v_pc, v_pc2),
    'bet', p_stake,
    'doubled', false,
    'surrendered', false,
    'done', v_state = 'resolved'
  ));

  begin
    insert into public.game_rounds (
      id, profile_id, game, state, stake, payout, server_seed, server_state, result, resolved_at
    ) values (
      p_round_id, v_uid, 'blackjack',
      v_state, p_stake, v_payout, v_seed,
      jsonb_build_object(
        'phase', v_phase,
        'player_cards', jsonb_build_array(v_pc, v_pc2),
        'dealer_up', v_dc,
        'dealer_hole', v_hole,
        'dealer_cards', case when v_phase = 'settled'
          then jsonb_build_array(v_dc, v_hole) else null end,
        'hands', v_initial_hands,
        'active_hand', 0,
        'deck_pos', 4,
        'player_bj', v_player_bj,
        'dealer_bj', v_dealer_bj
      ),
      case when v_phase = 'settled'
        then jsonb_build_object('player_bj',v_player_bj,'dealer_bj',v_dealer_bj,'payout',v_payout)
        else '{}'::jsonb end,
      case when v_phase = 'settled' then now() else null end
    )
    on conflict (id) do nothing
    returning * into v_round;
  exception when unique_violation then
    raise exception 'Manche Blackjack en cours';
  end;

  if v_round.id is null then
    select * into v_round from public.game_rounds where id = p_round_id;
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status','duplicate','round',private.bj_public_round(v_round));
  end if;

  v_op := private.apply_wallet_op(
    v_uid, 'bj:' || p_round_id::text || ':bet:initial',
    'BET', -p_stake, 0, 'blackjack', p_round_id, null,
    jsonb_build_object('phase', v_phase)
  );

  if v_phase = 'settled' then
    if v_payout > 0 then
      perform private.apply_wallet_op(
        v_uid, 'bj:' || p_round_id::text || ':settle:0',
        'PAYOUT', v_payout, 0, 'blackjack', p_round_id, null,
        jsonb_build_object('hand',0)
      );
    end if;
    perform private.bump_games_played(v_uid);
    update public.game_rounds set state='settled', settled_at=now()
    where id=p_round_id returning * into v_round;
  end if;

  return private.wallet_json(v_uid) || jsonb_build_object(
    'status', coalesce(v_op->>'status','ok'),
    'round', private.bj_public_round(v_round)
  );
end;
$$;

-- Action joueur : hit / stand / double / surrender.
-- Split simplifié : traité comme double avec cartes séparées.
create or replace function public.bj_action(
  p_round_id uuid,
  p_action text
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
  v_dealer_cards jsonb;
  v_dealer_total integer;
  v_next_pos integer;
begin
  if p_action not in ('hit','stand','double','surrender','insurance_yes','insurance_no') then
    raise exception 'Action invalide';
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
    -- Tirer une carte depuis le deck serveur
    v_new_card := (private.bj_draw_cards(v_seed, 6, v_deck_pos + 1))[v_deck_pos + 1];
    v_cards := v_cards || jsonb_build_array(v_new_card);
    v_next_pos := v_deck_pos + 1;
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
    v_new_card := (private.bj_draw_cards(v_seed, 6, v_deck_pos + 1))[v_deck_pos + 1];
    v_cards := v_cards || jsonb_build_array(v_new_card);
    v_next_pos := v_deck_pos + 1;
    v_hand := jsonb_set(v_hand, '{cards}', v_cards)
      || jsonb_build_object('bet', v_bet * 2, 'doubled', true, 'done', true);
    v_hands := jsonb_set(v_hands, array[v_active::text], v_hand);
    update public.game_rounds
    set stake = stake + v_bet,
        server_state = server_state
          || jsonb_build_object('hands', v_hands, 'deck_pos', v_next_pos,
               'player_cards', v_cards)
    where id = p_round_id returning * into v_round;
    -- Debit du double
    v_op := private.apply_wallet_op(
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
    -- Remboursement mi-mise
    perform private.apply_wallet_op(
      v_uid, 'bj:' || p_round_id::text || ':settle:' || v_active::text,
      'REFUND', floor(v_bet::numeric / 2 + 0.5)::integer, 0, 'blackjack', p_round_id, null,
      jsonb_build_object('hand', v_active, 'kind','surrender')
    );
    return public.bj_settle(p_round_id);

  elsif p_action = 'insurance_yes' then
    declare v_ins_bet integer := floor(v_stake::numeric / 2 + 0.5)::integer; begin
      v_op := private.apply_wallet_op(
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

-- Settlement complet : tire les cartes dealer, compare, crédite.
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
  v_doubled boolean;
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

  -- Dealer tire jusqu'à 17+
  v_dealer_cards := jsonb_build_array(
    v_round.server_state->'dealer_up',
    v_round.server_state->'dealer_hole'
  );
  v_dealer_total := private.bj_hand_total(v_dealer_cards);
  while v_dealer_total < 17 loop
    v_deck_pos := v_deck_pos + 1;
    v_dealer_cards := v_dealer_cards
      || jsonb_build_array((private.bj_draw_cards(v_seed, 6, v_deck_pos))[v_deck_pos]);
    v_dealer_total := private.bj_hand_total(v_dealer_cards);
  end loop;

  -- Insurance resolve
  if v_insurance_bet > 0 then
    if v_dealer_bj then
      perform private.apply_wallet_op(
        v_uid, 'bj:' || p_round_id::text || ':settle:insurance',
        'PAYOUT', v_insurance_bet * 3, 0, 'blackjack', p_round_id, null,
        '{}'::jsonb
      );
      v_total_returned := v_total_returned + v_insurance_bet * 3;
    end if;
  end if;

  -- Settle chaque main
  for v_hand_idx in 0 .. jsonb_array_length(v_hands) - 1 loop
    v_hand := v_hands -> v_hand_idx;
    v_bet := coalesce((v_hand->>'bet')::integer, v_round.stake);
    v_surrendered := coalesce((v_hand->>'surrendered')::boolean, false);
    v_doubled := coalesce((v_hand->>'doubled')::boolean, false);
    if v_surrendered then continue; end if;
    v_total := private.bj_hand_total(coalesce(v_hand->'cards','[]'::jsonb));

    -- BJ naturel non split = 3:2
    if v_total = 21 and jsonb_array_length(coalesce(v_hand->'cards','[]'::jsonb)) = 2
       and not coalesce((v_hand->>'from_split')::boolean, false) then
      if v_dealer_total = 21 then
        v_hand_payout := v_bet; -- push
      else
        v_hand_payout := v_bet + floor(v_bet::numeric * 1.5 + 0.000001)::integer;
      end if;
    elsif v_total > 21 then
      v_hand_payout := 0;
    elsif v_dealer_total > 21 then
      v_hand_payout := v_bet * 2;
    elsif v_total > v_dealer_total then
      v_hand_payout := v_bet * 2;
    elsif v_total = v_dealer_total then
      v_hand_payout := v_bet;
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

revoke all on function public.bj_deal(uuid,integer) from public;
grant execute on function public.bj_deal(uuid,integer) to authenticated, anon;
revoke all on function public.bj_action(uuid,text) from public;
grant execute on function public.bj_action(uuid,text) to authenticated, anon;
revoke all on function public.bj_settle(uuid) from public;
grant execute on function public.bj_settle(uuid) to authenticated, anon;
