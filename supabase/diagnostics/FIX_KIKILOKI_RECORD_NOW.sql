-- =============================================================================
-- COLLAGE UNIQUE — SQL Editor Supabase → Run
-- =============================================================================
-- Pourquoi 70 830 s’affiche encore : l’onglet Record lit player_scores du
-- Kikiloki DANS le cercle. Le 1 211 695 n’a jamais été écrit sur cette fiche
-- (nouvelle session anon sans profil). Les SQL du type
--   peak = max(peak, solde + coffre)
-- recopient 70 830 et ne changent RIEN.
--
-- Unités : centimes. 1 211 695,00 crédits = 121169500
-- =============================================================================

-- 0) Photo avant
select
  p.id,
  p.nickname,
  p.circle_id is not null as dans_le_cercle,
  s.balance / 100.0 as jouable,
  s.peak_balance / 100.0 as record,
  coalesce(s.vault, 0) / 100.0 as coffre,
  s.games_played,
  s.updated_at
from public.profiles p
left join public.player_scores s on s.profile_id = p.id
where lower(p.nickname) = 'kikiloki'
order by p.circle_id is not null desc, s.peak_balance desc nulls last;

-- 1) Recolle le plus haut score déjà en base (autres sessions / courbe)
with best as (
  select
    lower(p.nickname) as nick,
    max(greatest(
      coalesce(s.peak_balance, 0),
      coalesce(s.balance, 0) + coalesce(s.vault, 0)
    )) as peak,
    max(coalesce(s.balance, 0)) as bal
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

-- 2) ÉCRIT le 1,2 M sur la fiche Kikiloki DU CERCLE (celle que tu vois)
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

-- 3) Point sur la courbe
insert into public.credit_snapshots (profile_id, balance)
select p.id, 121048034
from public.profiles p
join public.player_scores s on s.profile_id = p.id
where lower(p.nickname) = 'kikiloki'
  and p.circle_id is not null;

-- 4) Photo après — tu dois voir record ≈ 1 211 695
select
  p.nickname,
  p.circle_id is not null as dans_le_cercle,
  s.balance / 100.0 as jouable,
  s.peak_balance / 100.0 as record,
  coalesce(s.vault, 0) / 100.0 as coffre,
  s.updated_at
from public.profiles p
join public.player_scores s on s.profile_id = p.id
where lower(p.nickname) = 'kikiloki'
order by p.circle_id is not null desc, s.peak_balance desc;
