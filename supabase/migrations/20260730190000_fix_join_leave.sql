-- Fix cercle: code inconnu ≠ création silencieuse + quitter retire vraiment du cloud

create or replace function public.join_circle(p_nickname text, p_code text default null)
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
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;
  if v_nick is null or char_length(v_nick) < 2 or char_length(v_nick) > 16 then
    raise exception 'Pseudo invalide (2–16 caractères)';
  end if;

  if v_code is null then
    -- Créer un nouveau cercle uniquement si aucun code fourni
    loop
      v_code := 'NOC-';
      for i in 1..4 loop
        v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      end loop;
      exit when not exists (select 1 from public.circles c where c.code = v_code);
    end loop;
    insert into public.circles (code, name)
    values (v_code, 'Cercle ' || v_nick)
    returning * into v_circle;
  else
    select * into v_circle from public.circles where code = v_code;
    if not found then
      raise exception 'Code cercle introuvable — vérifie bien les lettres (ex. EVJ ≠ EJV)';
    end if;
  end if;

  if exists (
    select 1 from public.profiles p
    where p.circle_id = v_circle.id
      and lower(p.nickname) = lower(v_nick)
      and p.id <> v_uid
  ) then
    raise exception 'Pseudo déjà pris dans ce cercle';
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
    'profile_id', v_profile.id,
    'nickname', v_profile.nickname,
    'circle_id', v_circle.id,
    'circle_code', v_circle.code,
    'circle_name', v_circle.name
  );
end;
$$;

revoke all on function public.join_circle(text, text) from public;
grant execute on function public.join_circle(text, text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- RPC : quitter le cercle (retire profil + scores du cloud)
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

  delete from public.player_scores where profile_id = v_uid;
  update public.profiles
    set circle_id = null
  where id = v_uid;
end;
$$;

revoke all on function public.leave_circle() from public;
grant execute on function public.leave_circle() to authenticated, anon;
