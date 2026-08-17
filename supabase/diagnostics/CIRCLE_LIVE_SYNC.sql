-- Coller dans SQL Editor (une fois) : verrou anti-wipe + realtime cercle.
-- Fichier source : supabase/migrations/20260817194000_circle_live_sync_invariants.sql

create or replace function public.enforce_score_invariants()
returns trigger
language plpgsql
as $$
declare
  v_new_wealth integer;
  v_old_wealth integer := 0;
begin
  v_new_wealth := coalesce(new.balance, 0) + coalesce(new.vault, 0);

  if TG_OP = 'UPDATE' then
    v_old_wealth := coalesce(old.balance, 0) + coalesce(old.vault, 0);
    new.peak_balance := greatest(
      coalesce(new.peak_balance, 0),
      coalesce(old.peak_balance, 0),
      v_new_wealth
    );
    if v_new_wealth < 100 and v_old_wealth >= 100
       and coalesce(new.games_played, 0) <= coalesce(old.games_played, 0) then
      new.balance := old.balance;
      new.vault := coalesce(old.vault, 0);
      v_new_wealth := v_old_wealth;
    end if;
  else
    new.peak_balance := greatest(coalesce(new.peak_balance, 0), v_new_wealth);
  end if;

  if v_new_wealth < 100 and coalesce(new.peak_balance, 0) >= 10000 then
    new.balance := new.peak_balance - coalesce(new.vault, 0);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_player_scores_invariants on public.player_scores;
create trigger trg_player_scores_invariants
before insert or update on public.player_scores
for each row execute function public.enforce_score_invariants();

alter table public.player_scores replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.player_scores;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
