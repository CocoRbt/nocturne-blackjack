-- Rattache la session courante au cercle (pseudo + code déjà connus en local).
-- Cas Kikiloki : l’UI montre encore le cercle (cache) mais profiles.circle_id
-- est null (session anon recréée / token expiré) → coffrer dit « Rejoins un cercle ».

create or replace function public.ensure_circle_membership(p_nickname text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nick text := private.normalize_nickname(p_nickname);
  v_code text := private.normalize_code(p_code);
  v_circle public.circles%rowtype;
  v_profile public.profiles%rowtype;
  v_other public.profiles%rowtype;
  v_mine public.player_scores%rowtype;
  v_old public.player_scores%rowtype;
  v_fresh boolean;
  v_starting constant integer := 10_000;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;
  if v_nick is null or char_length(v_nick) < 2 or char_length(v_nick) > 16 then
    raise exception 'Pseudo invalide (2–16 caractères)';
  end if;
  if v_code is null then
    raise exception 'Code cercle introuvable — vérifie bien les lettres (ex. EVJ ≠ EJV)';
  end if;

  select * into v_circle from public.circles where code = v_code;
  if not found then
    raise exception 'Code cercle introuvable — vérifie bien les lettres (ex. EVJ ≠ EJV)';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is not null and v_profile.circle_id is not distinct from v_circle.id then
    if v_profile.nickname is distinct from v_nick then
      if exists (
        select 1 from public.profiles p
        where p.circle_id = v_circle.id
          and lower(p.nickname) = lower(v_nick)
          and p.id <> v_uid
      ) then
        raise exception 'Pseudo déjà pris dans ce cercle';
      end if;
      update public.profiles set nickname = v_nick where id = v_uid;
    end if;
    insert into public.player_scores (profile_id) values (v_uid)
      on conflict (profile_id) do nothing;
    return jsonb_build_object(
      'ok', true,
      'profile_id', v_uid,
      'nickname', v_nick,
      'circle_id', v_circle.id,
      'circle_code', v_circle.code,
      'reclaimed', false
    );
  end if;

  select * into v_other
  from public.profiles p
  where p.circle_id = v_circle.id
    and lower(p.nickname) = lower(v_nick)
    and p.id <> v_uid;

  if v_other.id is not null then
    select * into v_mine from public.player_scores where profile_id = v_uid;
    v_fresh := v_mine.profile_id is null
      or (
        coalesce(v_mine.games_played, 0) = 0
        and coalesce(v_mine.vault, 0) = 0
        and coalesce(v_mine.balance, 0) <= v_starting
      );
    if not v_fresh then
      raise exception 'Pseudo déjà pris dans ce cercle';
    end if;

    select * into v_old from public.player_scores where profile_id = v_other.id;
    if v_old.profile_id is not null then
      insert into public.player_scores as s (
        profile_id, balance, peak_balance, vault, hands_played, blackjacks, best_streak,
        highest_table, games_before_peak, games_played, updated_at
      ) values (
        v_uid,
        v_old.balance,
        v_old.peak_balance,
        coalesce(v_old.vault, 0),
        v_old.hands_played,
        v_old.blackjacks,
        v_old.best_streak,
        v_old.highest_table,
        coalesce(v_old.games_before_peak, 0),
        coalesce(v_old.games_played, 0),
        now()
      )
      on conflict (profile_id) do update set
        balance = excluded.balance,
        peak_balance = greatest(s.peak_balance, excluded.peak_balance),
        vault = excluded.vault,
        hands_played = greatest(s.hands_played, excluded.hands_played),
        blackjacks = greatest(s.blackjacks, excluded.blackjacks),
        best_streak = greatest(s.best_streak, excluded.best_streak),
        highest_table = excluded.highest_table,
        games_before_peak = excluded.games_before_peak,
        games_played = greatest(s.games_played, excluded.games_played),
        updated_at = now();
    end if;

    update public.profiles set circle_id = null where id = v_other.id;
  end if;

  insert into public.profiles (id, nickname, circle_id)
  values (v_uid, v_nick, v_circle.id)
  on conflict (id) do update
    set nickname = excluded.nickname,
        circle_id = excluded.circle_id
  returning * into v_profile;

  insert into public.player_scores (profile_id)
  values (v_uid)
  on conflict (profile_id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'profile_id', v_profile.id,
    'nickname', v_profile.nickname,
    'circle_id', v_circle.id,
    'circle_code', v_circle.code,
    'reclaimed', v_other.id is not null
  );
end;
$$;

revoke all on function public.ensure_circle_membership(text, text) from public;
grant execute on function public.ensure_circle_membership(text, text) to authenticated, anon;
