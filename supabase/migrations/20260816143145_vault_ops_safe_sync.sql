-- Garantit dépôt/retrait coffre atomiques (à coller si les migrations
-- précédentes n’ont pas été appliquées sur le projet Supabase).

create or replace function public.deposit_my_vault(p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.player_scores%rowtype;
  v_amount integer;
  v_max_balance constant integer := 2_000_000_000;
  v_starting constant integer := 10_000;
  v_max_deposit integer;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 or v_amount > v_max_balance then
    raise exception 'Montant invalide';
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_uid and p.circle_id is not null) then
    raise exception 'Rejoins un cercle d''abord';
  end if;

  select * into v_row from public.player_scores where profile_id = v_uid for update;
  if v_row.profile_id is null then
    raise exception 'Score introuvable — synchronise d''abord';
  end if;

  v_max_deposit := greatest(0, coalesce(v_row.balance, 0) - v_starting);
  if v_amount > v_max_deposit then
    raise exception 'Pas assez de surplus à coffrer (max % crédits)', v_max_deposit / 100;
  end if;

  if coalesce(v_row.vault, 0) + v_amount > v_max_balance then
    raise exception 'Coffre plein — plafond atteint';
  end if;

  update public.player_scores
  set
    balance = balance - v_amount,
    vault = coalesce(vault, 0) + v_amount,
    peak_balance = greatest(peak_balance, balance - v_amount + coalesce(vault, 0) + v_amount),
    updated_at = now()
  where profile_id = v_uid
  returning * into v_row;

  insert into public.credit_snapshots (profile_id, balance)
  values (v_uid, v_row.balance);

  return jsonb_build_object(
    'ok', true,
    'amount', v_amount,
    'balance', v_row.balance,
    'vault', v_row.vault,
    'peak_balance', v_row.peak_balance
  );
end;
$$;

revoke all on function public.deposit_my_vault(integer) from public;
grant execute on function public.deposit_my_vault(integer) to authenticated, anon;

create or replace function public.withdraw_my_vault(p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.player_scores%rowtype;
  v_amount integer;
  v_new_bal integer;
  v_new_vault integer;
  v_max_balance constant integer := 2_000_000_000;
  v_room integer;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;

  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 or v_amount > v_max_balance then
    raise exception 'Montant invalide';
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_uid and p.circle_id is not null) then
    raise exception 'Rejoins un cercle d''abord';
  end if;

  select * into v_row from public.player_scores where profile_id = v_uid for update;
  if v_row.profile_id is null then
    raise exception 'Score introuvable — synchronise d''abord';
  end if;

  if coalesce(v_row.vault, 0) < v_amount then
    raise exception 'Pas assez dans le coffre (cloud: % crédits)', coalesce(v_row.vault, 0) / 100;
  end if;

  v_room := v_max_balance - coalesce(v_row.balance, 0);
  if v_amount > v_room then
    raise exception 'Solde max — tu ne peux retirer que % crédits pour l''instant', greatest(0, v_room / 100);
  end if;

  v_new_bal := coalesce(v_row.balance, 0) + v_amount;
  v_new_vault := coalesce(v_row.vault, 0) - v_amount;

  update public.player_scores
  set
    vault = v_new_vault,
    balance = v_new_bal,
    peak_balance = greatest(peak_balance, v_new_bal + v_new_vault),
    updated_at = now()
  where profile_id = v_uid
  returning * into v_row;

  insert into public.credit_snapshots (profile_id, balance)
  values (v_uid, v_row.balance);

  return jsonb_build_object(
    'ok', true,
    'amount', v_amount,
    'balance', v_row.balance,
    'vault', v_row.vault,
    'peak_balance', v_row.peak_balance
  );
end;
$$;

revoke all on function public.withdraw_my_vault(integer) from public;
grant execute on function public.withdraw_my_vault(integer) to authenticated, anon;
