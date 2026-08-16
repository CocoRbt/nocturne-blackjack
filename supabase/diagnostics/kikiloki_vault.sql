-- Diagnostic coffre (ex. Kikiloki) — à coller dans le SQL Editor Supabase.
-- Remplace le pseudo si besoin.

select
  p.nickname,
  s.balance / 100.0 as jouable,
  coalesce(s.vault, 0) / 100.0 as coffre,
  (s.balance + coalesce(s.vault, 0)) / 100.0 as patrimoine,
  s.games_played,
  s.updated_at
from public.player_scores s
join public.profiles p on p.id = s.profile_id
where p.nickname ilike 'kikiloki';

-- Vérifie que les RPC coffre existent :
select proname
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('deposit_my_vault', 'withdraw_my_vault', 'sync_my_score')
order by proname;
