-- Sync cercle : le classement affiche le vrai portefeuille du téléphone,
-- pas un record tamponné. Interdit d’écrire un montant en dur (1,2 M, etc.).
--
-- 1) sync_my_score accepte le catch-up : si le pic local a monté, on écrit
--    aussi le solde (push raté / nouvelle session). Le record ne descend jamais,
--    même si games_played est stale.
-- 2) get_leaderboards : Record = max du pseudo (toutes sessions + courbe).

create or replace function public.sync_my_score(
  p_balance integer,
  p_peak_balance integer,
  p_hands_played integer default 0,
  p_blackjacks integer default 0,
  p_best_streak integer default 0,
  p_highest_table text default 'emeraude',
  p_games_before_peak integer default 0,
  p_games_played integer default 0,
  p_vault integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.player_scores%rowtype;
  v_prev public.player_scores%rowtype;
  v_bal integer;
  v_peak integer;
  v_vault integer;
  v_games integer;
  v_wealth integer;
  v_prev_wealth integer;
  v_vault_delta integer;
  v_bal_delta integer;
  v_peak_catchup boolean := false;
  v_max_balance constant integer := 2_000_000_000;
  v_starting constant integer := 10_000;
  v_allowed_tables text[] := array['emeraude', 'onyx', 'imperiale', 'privee'];
  v_last_snap integer;
  v_stale boolean := false;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;
  if p_balance is null or p_balance < 0 or p_peak_balance is null or p_peak_balance < 0 then
    raise exception 'Scores invalides';
  end if;
  if p_vault is null or p_vault < 0 then
    raise exception 'vault invalide';
  end if;
  if p_games_before_peak is null or p_games_before_peak < 0 then
    raise exception 'games_before_peak invalide';
  end if;
  if p_games_played is null or p_games_played < 0 then
    raise exception 'games_played invalide';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.circle_id is not null) then
    raise exception 'Rejoins un cercle d''abord';
  end if;
  if p_highest_table is not null and not (p_highest_table = any (v_allowed_tables)) then
    raise exception 'Table invalide';
  end if;

  v_bal := least(p_balance, v_max_balance);
  v_vault := least(p_vault, v_max_balance);
  v_peak := least(greatest(p_peak_balance, p_balance + coalesce(p_vault, 0)), v_max_balance);
  v_games := p_games_played;

  select * into v_prev from public.player_scores where profile_id = v_uid for update;

  if v_prev.profile_id is not null then
    if v_games < coalesce(v_prev.games_played, 0) then
      v_stale := true;
      v_bal := v_prev.balance;
      v_vault := coalesce(v_prev.vault, 0);
      v_peak := greatest(v_peak, coalesce(v_prev.peak_balance, 0));
      v_games := coalesce(v_prev.games_played, 0);
    end if;

    if not v_stale then
      v_peak := greatest(v_peak, coalesce(v_prev.peak_balance, 0));

      v_vault_delta := v_vault - coalesce(v_prev.vault, 0);
      v_bal_delta := v_bal - coalesce(v_prev.balance, 0);
      v_prev_wealth := coalesce(v_prev.balance, 0) + coalesce(v_prev.vault, 0);
      v_wealth := v_bal + v_vault;
      -- Téléphone plus riche, pic déjà monté (sync précédente ratée).
      v_peak_catchup := v_peak > coalesce(v_prev.peak_balance, 0)
        and v_wealth <= v_peak + 1;

      if v_vault_delta > 0 and abs((-v_bal_delta) - v_vault_delta) > 1 then
        if abs(v_wealth - v_prev_wealth) <= 1 then
          null;
        else
          v_vault := coalesce(v_prev.vault, 0);
          v_bal := coalesce(v_prev.balance, 0);
          v_vault_delta := 0;
          v_bal_delta := 0;
          v_wealth := v_prev_wealth;
        end if;
      end if;

      if v_vault_delta < 0 and abs(v_bal_delta - (-v_vault_delta)) > 1 then
        v_vault := coalesce(v_prev.vault, 0);
        v_vault_delta := 0;
        v_bal_delta := v_bal - coalesce(v_prev.balance, 0);
        v_wealth := v_bal + v_vault;
      end if;

      if v_games = coalesce(v_prev.games_played, 0)
        and v_bal < coalesce(v_prev.balance, 0)
        and v_vault_delta = 0
      then
        v_bal := coalesce(v_prev.balance, 0);
        v_bal_delta := 0;
        v_wealth := v_bal + v_vault;
      end if;

      if v_bal_delta > 0
        and v_vault_delta >= 0
        and v_games <= coalesce(v_prev.games_played, 0)
        and not v_peak_catchup
      then
        if coalesce(v_prev.balance, 0) < 100
          and v_bal <= v_starting
          and v_vault_delta = 0
        then
          null;
        elsif v_bal_delta <= 3000 and v_vault_delta = 0 then
          null;
        else
          v_bal := coalesce(v_prev.balance, 0);
          v_wealth := v_bal + v_vault;
        end if;
      end if;

      if v_wealth > v_prev_wealth + 100_000
        and v_games <= coalesce(v_prev.games_played, 0)
        and not v_peak_catchup
      then
        v_bal := v_prev.balance;
        v_vault := coalesce(v_prev.vault, 0);
      end if;
    end if;
  end if;

  v_peak := least(greatest(v_peak, coalesce(v_prev.peak_balance, 0), v_bal + v_vault), v_max_balance);

  insert into public.player_scores as s (
    profile_id, balance, peak_balance, vault, hands_played, blackjacks, best_streak,
    highest_table, games_before_peak, games_played, updated_at
  ) values (
    v_uid, v_bal, v_peak, v_vault, p_hands_played, p_blackjacks, p_best_streak,
    coalesce(p_highest_table, 'emeraude'), p_games_before_peak, v_games, now()
  )
  on conflict (profile_id) do update set
    balance = excluded.balance,
    vault = excluded.vault,
    peak_balance = greatest(s.peak_balance, excluded.peak_balance, excluded.balance + coalesce(excluded.vault, 0)),
    hands_played = greatest(s.hands_played, excluded.hands_played),
    blackjacks = greatest(s.blackjacks, excluded.blackjacks),
    best_streak = greatest(s.best_streak, excluded.best_streak),
    highest_table = excluded.highest_table,
    games_played = greatest(s.games_played, excluded.games_played),
    games_before_peak = case
      when greatest(excluded.peak_balance, excluded.balance) > s.peak_balance
        then excluded.games_before_peak
      when s.games_before_peak = 0
        and excluded.games_before_peak > 0
        and greatest(excluded.peak_balance, excluded.balance) >= s.peak_balance
        then excluded.games_before_peak
      else s.games_before_peak
    end,
    updated_at = now()
  returning * into v_row;

  select cs.balance into v_last_snap
  from public.credit_snapshots cs
  where cs.profile_id = v_uid
  order by cs.recorded_at desc
  limit 1;

  if v_last_snap is null or v_last_snap is distinct from v_row.balance then
    insert into public.credit_snapshots (profile_id, balance)
    values (v_uid, v_row.balance);
  end if;

  return jsonb_build_object(
    'balance', v_row.balance,
    'peak_balance', v_row.peak_balance,
    'vault', v_row.vault,
    'games_before_peak', v_row.games_before_peak,
    'games_played', v_row.games_played,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.sync_my_score(integer, integer, integer, integer, integer, text, integer, integer, integer) from public;
grant execute on function public.sync_my_score(integer, integer, integer, integer, integer, text, integer, integer, integer) to authenticated, anon;

-- Recolle les pics déjà en base (même pseudo, autre session / courbe) — pas de chiffre en dur
with best as (
  select
    lower(p.nickname) as nick,
    max(greatest(
      coalesce(s.peak_balance, 0),
      coalesce(s.balance, 0) + coalesce(s.vault, 0)
    )) as peak
  from public.profiles p
  join public.player_scores s on s.profile_id = p.id
  group by 1
),
snap as (
  select
    lower(p.nickname) as nick,
    max(cs.balance) as snap_peak
  from public.profiles p
  join public.credit_snapshots cs on cs.profile_id = p.id
  group by 1
)
update public.player_scores s
set
  peak_balance = greatest(
    s.peak_balance,
    coalesce(b.peak, 0),
    coalesce(n.snap_peak, 0)
  ),
  updated_at = now()
from public.profiles p
left join best b on b.nick = lower(p.nickname)
left join snap n on n.nick = lower(p.nickname)
where s.profile_id = p.id
  and p.circle_id is not null
  and greatest(s.peak_balance, coalesce(b.peak, 0), coalesce(n.snap_peak, 0))
      > s.peak_balance;

create or replace function public.get_leaderboards()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_circle uuid;
  v_live jsonb;
  v_peak jsonb;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  select circle_id into v_circle from public.profiles where id = v_uid;
  if v_circle is null then
    return jsonb_build_object('live', '[]'::jsonb, 'peak', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.rank), '[]'::jsonb)
  into v_live
  from (
    select
      row_number() over (
        order by (s.balance + coalesce(s.vault, 0)) desc, s.updated_at asc
      ) as rank,
      p.nickname,
      s.balance,
      greatest(
        s.peak_balance,
        s.balance + coalesce(s.vault, 0),
        coalesce((
          select max(greatest(
            s2.peak_balance,
            s2.balance + coalesce(s2.vault, 0)
          ))
          from public.player_scores s2
          join public.profiles p2 on p2.id = s2.profile_id
          where lower(p2.nickname) = lower(p.nickname)
        ), 0),
        coalesce((
          select max(cs.balance)
          from public.credit_snapshots cs
          join public.profiles p2 on p2.id = cs.profile_id
          where lower(p2.nickname) = lower(p.nickname)
        ), 0)
      ) as peak_balance,
      s.vault,
      s.games_before_peak,
      s.updated_at,
      (p.id = v_uid) as is_me
    from public.player_scores s
    join public.profiles p on p.id = s.profile_id
    where p.circle_id = v_circle
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.rank), '[]'::jsonb)
  into v_peak
  from (
    select
      row_number() over (
        order by greatest(
          s.peak_balance,
          s.balance + coalesce(s.vault, 0),
          coalesce((
            select max(greatest(
              s2.peak_balance,
              s2.balance + coalesce(s2.vault, 0)
            ))
            from public.player_scores s2
            join public.profiles p2 on p2.id = s2.profile_id
            where lower(p2.nickname) = lower(p.nickname)
          ), 0),
          coalesce((
            select max(cs.balance)
            from public.credit_snapshots cs
            join public.profiles p2 on p2.id = cs.profile_id
            where lower(p2.nickname) = lower(p.nickname)
          ), 0)
        ) desc,
        s.updated_at asc
      ) as rank,
      p.nickname,
      s.balance,
      greatest(
        s.peak_balance,
        s.balance + coalesce(s.vault, 0),
        coalesce((
          select max(greatest(
            s2.peak_balance,
            s2.balance + coalesce(s2.vault, 0)
          ))
          from public.player_scores s2
          join public.profiles p2 on p2.id = s2.profile_id
          where lower(p2.nickname) = lower(p.nickname)
        ), 0),
        coalesce((
          select max(cs.balance)
          from public.credit_snapshots cs
          join public.profiles p2 on p2.id = cs.profile_id
          where lower(p2.nickname) = lower(p.nickname)
        ), 0)
      ) as peak_balance,
      s.vault,
      s.games_before_peak,
      s.updated_at,
      (p.id = v_uid) as is_me
    from public.player_scores s
    join public.profiles p on p.id = s.profile_id
    where p.circle_id = v_circle
  ) t;

  return jsonb_build_object('live', v_live, 'peak', v_peak);
end;
$$;

revoke all on function public.get_leaderboards() from public;
grant execute on function public.get_leaderboards() to authenticated, anon;
