-- Remonte les seeds jackpot Stampede (cercle 3–4 potes, soldes ~4–5k).
-- Mini 1 000 / Major 5 000 / Grand 15 000 crédits.

alter table public.circle_jackpots
  alter column mini set default 100000,
  alter column major set default 500000,
  alter column grand set default 1500000;

-- Les pots déjà sous le nouveau plancher remontent ; ceux déjà plus hauts restent.
update public.circle_jackpots
set
  mini = greatest(mini, 100000),
  major = greatest(major, 500000),
  grand = greatest(grand, 1500000),
  updated_at = now();

create or replace function public.ensure_circle_jackpots(p_circle uuid)
returns public.circle_jackpots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.circle_jackpots%rowtype;
begin
  insert into public.circle_jackpots (circle_id, mini, major, grand)
  values (p_circle, 100000, 500000, 1500000)
  on conflict (circle_id) do nothing;

  select * into v_row from public.circle_jackpots where circle_id = p_circle for update;
  return v_row;
end;
$$;

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
