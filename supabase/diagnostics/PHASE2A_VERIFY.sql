-- Phase 2a — vérifications READ ONLY après déploiement (ne pas exécuter avant GO).
-- Aucun UPDATE / INSERT / DELETE.

-- 1) Le bloc « même games_played + balance ↓ → restaurer » a disparu.
select
  'sync_my_score still restores mid-bet loss' as check,
  position(
    'v_games = coalesce(v_prev.games_played, 0)' in pg_get_functiondef(
      'public.sync_my_score(integer, integer, integer, integer, integer, text, integer, integer, integer)'::regprocedure
    )
  ) > 0 as failed;

-- 2) Le trigger ne restaure plus OLD.balance / OLD.vault.
select
  'enforce_score_invariants restores old wallet' as check,
  (
    pg_get_functiondef('public.enforce_score_invariants()'::regprocedure) ilike '%new.balance := old.balance%'
    or pg_get_functiondef('public.enforce_score_invariants()'::regprocedure) ilike '%new.vault := coalesce(old.vault%'
    or pg_get_functiondef('public.enforce_score_invariants()'::regprocedure) ilike '%new.balance := new.peak_balance%'
  ) as failed;

-- 3) enforce_wealth_peak existe toujours (record-only, autorisé Phase 2a).
select
  tgname,
  pg_get_triggerdef(oid) as def
from pg_trigger
where tgrelid = 'public.player_scores'::regclass
  and not tgisinternal
order by tgname;
