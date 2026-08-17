-- Record Kikiloki : le 1,2 M est resté sur le téléphone (nouvelle session anon).
-- L’onglet Record lit la fiche encore dans le cercle (~70 830). On écrit le pic
-- sur cette fiche, on recolle les pics homonymes, et get_leaderboards prend
-- le max du pseudo (toutes sessions), pas seulement la ligne courante.

-- Recolle le plus haut score déjà en base (sessions fantômes / courbe)
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

-- 1 211 695,00 crédits = 121169500 centimes (capture écran Kikiloki)
-- 1 210 480,34 crédits = 121048034 centimes
update public.player_scores s
set
  peak_balance = greatest(s.peak_balance, 121169500),
  balance = greatest(s.balance, 121048034),
  games_before_peak = greatest(
    coalesce(s.games_before_peak, 0),
    coalesce(s.games_played, 0)
  ),
  updated_at = now()
from public.profiles p
where p.id = s.profile_id
  and lower(p.nickname) = 'kikiloki'
  and p.circle_id is not null;

insert into public.credit_snapshots (profile_id, balance)
select p.id, 121048034
from public.profiles p
join public.player_scores s on s.profile_id = p.id
where lower(p.nickname) = 'kikiloki'
  and p.circle_id is not null;

-- Classement Record : max du pseudo, même si le 1,2 M est sur une autre session
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
