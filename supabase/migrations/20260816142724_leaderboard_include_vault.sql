-- Classements : le coffre compte dans le patrimoine (live + record).
-- Avant : tri / record = solde jouable seul → coffrer faisait « disparaître » du classement.

-- Backfill record = max(record, solde + coffre)
update public.player_scores
set peak_balance = greatest(peak_balance, balance + coalesce(vault, 0))
where peak_balance < balance + coalesce(vault, 0);

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
      greatest(s.peak_balance, s.balance + coalesce(s.vault, 0)) as peak_balance,
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
        order by greatest(s.peak_balance, s.balance + coalesce(s.vault, 0)) desc,
                 s.updated_at asc
      ) as rank,
      p.nickname,
      s.balance,
      greatest(s.peak_balance, s.balance + coalesce(s.vault, 0)) as peak_balance,
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

-- Retrait coffre : le record suit le patrimoine (solde + coffre restant).
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
    raise exception 'Pas assez dans le coffre';
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
