-- Répare classements + records (peak ≥ solde + coffre) et garantit les RPC coffre.
-- À coller dans le SQL Editor si les migrations du 16/08 n’ont pas été appliquées.

create or replace function public.enforce_wealth_peak()
returns trigger
language plpgsql
as $$
begin
  new.peak_balance := greatest(
    coalesce(new.peak_balance, 0),
    coalesce(new.balance, 0) + coalesce(new.vault, 0)
  );
  return new;
end;
$$;

drop trigger if exists trg_player_scores_wealth_peak on public.player_scores;
create trigger trg_player_scores_wealth_peak
before insert or update on public.player_scores
for each row execute function public.enforce_wealth_peak();

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
