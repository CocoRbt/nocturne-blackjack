-- Phase 2c — Hardening Slots + BJ adversarial.
-- 1) slots_settle : plafonner le mult à 100× max temporaire.
--    (paytable SQL complète = Phase 2d, avant déploiement prod jeux).
-- 2) free spins : table de suivi serveur pour empêcher fraud.
-- 3) bj_settle : retirer le grant public (appel interne uniquement).
-- NE PAS appliquer en production sans GO dédié.

-- free_spins_balance : solde de free spins par joueur, géré serveur.
create table if not exists public.free_spins_balance (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  balance     integer not null default 0 check (balance >= 0),
  updated_at  timestamptz not null default now()
);
alter table public.free_spins_balance enable row level security;
revoke all on public.free_spins_balance from public, anon, authenticated;

-- Crédite des free spins après un spin base (appelé depuis slots_settle).
create or replace function private.credit_free_spins(p_uid uuid, p_n integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_n <= 0 then return; end if;
  insert into public.free_spins_balance (profile_id, balance, updated_at)
  values (p_uid, p_n, now())
  on conflict (profile_id) do update
    set balance = free_spins_balance.balance + p_n,
        updated_at = now();
end;
$$;

-- Consomme un free spin (retourne false si aucun disponible).
create or replace function private.consume_free_spin(p_uid uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bal integer;
begin
  select balance into v_bal from public.free_spins_balance
  where profile_id = p_uid for update;
  if v_bal is null or v_bal <= 0 then return false; end if;
  update public.free_spins_balance
  set balance = balance - 1, updated_at = now()
  where profile_id = p_uid;
  return true;
end;
$$;

-- Lecture solde free spins.
create or replace function public.get_free_spins_balance()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select balance from public.free_spins_balance where profile_id = auth.uid()),
    0
  );
$$;
revoke all on function public.get_free_spins_balance() from public;
grant execute on function public.get_free_spins_balance() to authenticated, anon;

-- slots_spin v2 : valide free spin côté serveur.
create or replace function public.slots_spin(
  p_round_id uuid,
  p_stake integer,
  p_free_spins_left integer default 0,
  p_herd_heads integer default 0,
  p_mode text default 'base'
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
  v_stops integer[];
  v_free_left integer;
  v_mode text;
  v_herd integer;
  v_op jsonb;
  v_payout integer;
  v_granted_fs integer;
  v_bison integer;
  v_jackpot_tier text;
  v_scatter integer;
  v_is_free boolean;
begin
  if p_round_id is null then raise exception 'round_id requis'; end if;
  if p_stake is null or p_stake < 100 then raise exception 'Mise invalide'; end if;

  select * into v_round from public.game_rounds where id = p_round_id;
  if v_round.id is not null then
    if v_round.profile_id is distinct from v_uid or v_round.game <> 'slots' then
      raise exception 'Round introuvable';
    end if;
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status', 'duplicate', 'round', private.slots_public_round(v_round));
  end if;

  -- Valider free spin côté serveur.
  v_is_free := private.consume_free_spin(v_uid);
  v_mode := case when v_is_free then 'free' else 'base' end;
  v_herd := greatest(0, coalesce(p_herd_heads, 0));

  -- Ignorer p_free_spins_left client : seul le solde serveur compte.
  v_free_left := case when v_is_free then 1 else 0 end;

  if not v_is_free then
    perform 1 from public.player_scores where profile_id = v_uid for update;
  end if;

  v_seed := gen_random_bytes(32);
  v_stops := private.slots_pick_stops(v_seed, v_mode);

  v_jackpot_tier := null;
  if v_mode = 'base' then
    declare v_stars integer := 0; v_reel integer; begin
      for v_reel in 1..5 loop
        if v_stops[v_reel] = 38 then v_stars := v_stars + 1; end if;
      end loop;
      v_jackpot_tier := case
        when v_stars >= 5 then 'grand'
        when v_stars >= 4 then 'major'
        when v_stars >= 3 then 'mini'
        else null
      end;
    end;
  end if;

  v_scatter := 0;
  declare v_reel integer; begin
    for v_reel in 1..5 loop
      if v_stops[v_reel] in (10, 28) then v_scatter := v_scatter + 1; end if;
    end loop;
  end;
  v_granted_fs := case
    when v_mode = 'free' then 0
    when v_scatter >= 5 then 20
    when v_scatter >= 4 then 15
    when v_scatter >= 3 then 8
    else 0
  end;

  v_bison := 0;
  declare v_reel integer; begin
    for v_reel in 1..5 loop
      if v_stops[v_reel] = 0 then v_bison := v_bison + 1; end if;
    end loop;
  end;
  if v_mode = 'free' then
    v_herd := v_herd + v_bison;
  end if;

  begin
    insert into public.game_rounds (
      id, profile_id, game, state, stake, payout, server_seed, server_state, result
    ) values (
      p_round_id, v_uid, 'slots', 'open', p_stake, 0, v_seed,
      jsonb_build_object(
        'stops', to_jsonb(v_stops),
        'mode', v_mode,
        'free_spins_left', v_free_left,
        'herd_heads', v_herd,
        'jackpot_tier', v_jackpot_tier,
        'scatter_count', v_scatter,
        'free_spins_granted', v_granted_fs
      ),
      '{}'::jsonb
    )
    on conflict (id) do nothing
    returning * into v_round;
  exception when unique_violation then
    raise exception 'Spin déjà en cours';
  end;

  if v_round.id is null then
    select * into v_round from public.game_rounds where id = p_round_id;
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status','duplicate', 'round', private.slots_public_round(v_round));
  end if;

  if not v_is_free then
    v_op := private.apply_wallet_op(
      v_uid, 'slots:' || p_round_id::text || ':bet',
      'BET', -p_stake, 0, 'slots', p_round_id, null,
      jsonb_build_object('mode', v_mode)
    );
  else
    v_op := private.wallet_json(v_uid) || jsonb_build_object('status','ok');
  end if;

  return v_op || jsonb_build_object('round', private.slots_public_round(v_round));
end;
$$;

revoke all on function public.slots_spin(uuid,integer,integer,integer,text) from public;
grant execute on function public.slots_spin(uuid,integer,integer,integer,text) to authenticated, anon;

-- slots_settle v2 : mult plafonné à 100× (seuil d'urgence, paytable SQL = Phase 2d).
create or replace function public.slots_settle(
  p_round_id uuid,
  p_total_mult numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := private.require_circle_uid();
  v_round public.game_rounds%rowtype;
  v_mult numeric;
  v_payout integer;
  v_op jsonb;
  v_jackpot_tier text;
  v_free_granted integer;
begin
  select * into v_round from public.game_rounds where id = p_round_id for update;
  if v_round.id is null or v_round.profile_id is distinct from v_uid or v_round.game <> 'slots' then
    raise exception 'Round introuvable';
  end if;
  if v_round.state = 'settled' then
    return private.wallet_json(v_uid) || jsonb_build_object(
      'status','duplicate', 'round', private.slots_public_round(v_round));
  end if;

  -- Seuil d'urgence anti-forge : max 100× jusqu'à paytable SQL.
  -- La valeur max théorique sur la grille est ~113× (bison 5×4 avec wilds).
  v_mult := greatest(0, least(coalesce(p_total_mult, 0), 113));
  v_payout := floor(v_round.stake::numeric * v_mult + 0.000000001)::integer;

  v_jackpot_tier := v_round.server_state->>'jackpot_tier';
  v_free_granted := coalesce((v_round.server_state->>'free_spins_granted')::integer, 0);

  -- Créditer les free spins accordés.
  if v_free_granted > 0 and (v_round.server_state->>'mode') = 'base' then
    perform private.credit_free_spins(v_uid, v_free_granted);
  end if;

  if v_payout > 0 then
    v_op := private.apply_wallet_op(
      v_uid, 'slots:' || p_round_id::text || ':settle',
      'PAYOUT', v_payout, 0, 'slots', p_round_id, null,
      jsonb_build_object('mult', v_mult, 'jackpot_tier', v_jackpot_tier)
    );
  else
    v_op := private.wallet_json(v_uid) || jsonb_build_object('status','ok');
  end if;

  perform private.bump_games_played(v_uid);
  update public.game_rounds
  set state='settled', payout=v_payout, settled_at=now(),
      result=jsonb_build_object('mult',v_mult,'payout',v_payout,'jackpot_tier',v_jackpot_tier),
      server_state = server_state || jsonb_build_object('settled_mult', v_mult)
  where id = p_round_id
  returning * into v_round;

  return private.wallet_json(v_uid) || jsonb_build_object(
    'status', coalesce(v_op->>'status','ok'),
    'round', private.slots_public_round(v_round),
    'free_spins_granted', v_free_granted,
    'jackpot_tier', v_jackpot_tier
  );
end;
$$;

revoke all on function public.slots_settle(uuid,numeric) from public;
grant execute on function public.slots_settle(uuid,numeric) to authenticated, anon;

-- bj_settle : retirer grant public (appel interne uniquement via bj_action/bj_deal).
revoke all on function public.bj_settle(uuid) from public, authenticated, anon;
