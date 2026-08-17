-- URGENCE : solde à 0 alors que le record est à 1,2 M.
-- SQL Editor → coller → Run. Recolle le jouable sur le pic (pas un chiffre en dur).

update public.player_scores s
set
  balance = greatest(
    s.balance,
    s.peak_balance - coalesce(s.vault, 0),
    coalesce((
      select max(s2.peak_balance) - coalesce(s.vault, 0)
      from public.player_scores s2
      join public.profiles p2 on p2.id = s2.profile_id
      where lower(p2.nickname) = lower(p.nickname)
    ), 0)
  ),
  updated_at = now()
from public.profiles p
where s.profile_id = p.id
  and (s.balance + coalesce(s.vault, 0)) < 100
  and greatest(
    s.peak_balance,
    coalesce((
      select max(s2.peak_balance)
      from public.player_scores s2
      join public.profiles p2 on p2.id = s2.profile_id
      where lower(p2.nickname) = lower(p.nickname)
    ), 0)
  ) >= 100000000;

select
  p.nickname,
  s.balance / 100.0 as jouable,
  s.peak_balance / 100.0 as record,
  coalesce(s.vault, 0) / 100.0 as coffre
from public.profiles p
join public.player_scores s on s.profile_id = p.id
where lower(p.nickname) = 'kikiloki'
order by s.peak_balance desc;
