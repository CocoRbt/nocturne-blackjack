-- Sortie de cercle douce : on ne détruit PLUS les scores.
-- get_my_score enrichi : code cercle pour restaurer l’UI après login compte.

-- ---------------------------------------------------------------------------
-- leave_circle : détache seulement (garde player_scores + credit_snapshots)
-- ---------------------------------------------------------------------------

create or replace function public.leave_circle()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  -- Soft leave : le classement peut revenir en rejoignant le même code.
  update public.profiles
    set circle_id = null
  where id = v_uid;
end;
$$;

revoke all on function public.leave_circle() from public;
grant execute on function public.leave_circle() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- get_my_score : + membership cercle (restauration après connexion compte)
-- ---------------------------------------------------------------------------

create or replace function public.get_my_score()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.player_scores%rowtype;
  v_nick text;
  v_circle_id uuid;
  v_circle_code text;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  select p.nickname, p.circle_id, c.code
    into v_nick, v_circle_id, v_circle_code
  from public.profiles p
  left join public.circles c on c.id = p.circle_id
  where p.id = v_uid;

  select * into v_row from public.player_scores where profile_id = v_uid;

  if v_row.profile_id is null then
    return jsonb_build_object(
      'found', false,
      'nickname', v_nick,
      'circle_id', v_circle_id,
      'circle_code', v_circle_code,
      'in_circle', v_circle_id is not null
    );
  end if;

  return jsonb_build_object(
    'found', true,
    'nickname', v_nick,
    'circle_id', v_circle_id,
    'circle_code', v_circle_code,
    'in_circle', v_circle_id is not null,
    'balance', v_row.balance,
    'peak_balance', v_row.peak_balance,
    'hands_played', v_row.hands_played,
    'blackjacks', v_row.blackjacks,
    'best_streak', v_row.best_streak,
    'highest_table', v_row.highest_table,
    'games_before_peak', coalesce(v_row.games_before_peak, 0),
    'games_played', coalesce(v_row.games_played, 0),
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.get_my_score() from public;
grant execute on function public.get_my_score() to anon, authenticated;
