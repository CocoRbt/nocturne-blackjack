-- Fix FK : ne JAMAIS écrire player_scores avant profiles.
-- Ne pas copier l’ancien wallet 70k sur la nouvelle session (ça bloquait
-- ensuite le push du vrai solde local, ex. Kikiloki 1,2 M).

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
  v_fresh boolean;
  v_starting constant integer := 10_000;
  v_reclaimed boolean := false;
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
    -- Lâche le pseudo sur l’ancienne session ; le client poussera le vrai solde.
    update public.profiles set circle_id = null where id = v_other.id;
    v_reclaimed := true;
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
    'reclaimed', v_reclaimed
  );
end;
$$;

revoke all on function public.ensure_circle_membership(text, text) from public;
grant execute on function public.ensure_circle_membership(text, text) to authenticated, anon;
