-- Ancien plafond d’envoi : 50 000 crédits — trop bas pour les gros stacks.
-- Aligne sur le plafond coffre / sync.

create or replace function public.send_circle_vault(
  p_to_nickname text,
  p_amount integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_circle uuid;
  v_from public.player_scores%rowtype;
  v_to public.player_scores%rowtype;
  v_to_id uuid;
  v_to_nick text;
  v_amount integer;
  v_max_send constant integer := 2_000_000_000;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 or v_amount > v_max_send then
    raise exception 'Montant invalide (max % crédits)', v_max_send / 100;
  end if;

  v_to_nick := trim(both from coalesce(p_to_nickname, ''));
  if char_length(v_to_nick) < 2 or char_length(v_to_nick) > 16 then
    raise exception 'Pseudo invalide';
  end if;

  select circle_id into v_circle from public.profiles where id = v_uid;
  if v_circle is null then
    raise exception 'Rejoins un cercle d''abord';
  end if;

  select p.id into v_to_id
  from public.profiles p
  where p.circle_id = v_circle
    and lower(p.nickname) = lower(v_to_nick)
  limit 1;

  if v_to_id is null then
    raise exception 'Pote introuvable dans ton cercle';
  end if;

  if v_to_id = v_uid then
    raise exception 'Tu ne peux pas t''envoyer des crédits';
  end if;

  if v_uid < v_to_id then
    select * into v_from from public.player_scores where profile_id = v_uid for update;
    select * into v_to from public.player_scores where profile_id = v_to_id for update;
  else
    select * into v_to from public.player_scores where profile_id = v_to_id for update;
    select * into v_from from public.player_scores where profile_id = v_uid for update;
  end if;

  if v_from.profile_id is null then
    raise exception 'Score introuvable — synchronise d''abord';
  end if;
  if v_to.profile_id is null then
    insert into public.player_scores (profile_id, balance, peak_balance, vault, updated_at)
    values (v_to_id, 0, 0, 0, now())
    returning * into v_to;
  end if;

  if coalesce(v_from.vault, 0) < v_amount then
    raise exception 'Pas assez dans le coffre (il faut coffrer avant d''envoyer)';
  end if;

  update public.player_scores
  set vault = vault - v_amount,
      updated_at = now()
  where profile_id = v_uid
  returning * into v_from;

  update public.player_scores
  set vault = coalesce(vault, 0) + v_amount,
      updated_at = now()
  where profile_id = v_to_id
  returning * into v_to;

  return jsonb_build_object(
    'ok', true,
    'amount', v_amount,
    'to_nickname', v_to_nick,
    'vault', v_from.vault,
    'to_vault', v_to.vault
  );
end;
$$;

revoke all on function public.send_circle_vault(text, integer) from public;
grant execute on function public.send_circle_vault(text, integer) to authenticated, anon;
