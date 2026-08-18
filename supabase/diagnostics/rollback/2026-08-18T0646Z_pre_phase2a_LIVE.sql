-- NOCTURNE — Sauvegarde LIVE pré-Phase 2a (production)
-- Capturé le 2026-08-18T06:46:00Z via pg_get_functiondef / pg_get_triggerdef
-- Projet : gyazoruuxxezuodkhwoz (Nocturne_Blackjack)
-- PITR : indisponible (plan org = free). Rollback = réexécuter ce fichier.
-- Empreinte wallets AVANT migration (lecture seule) :
--   n=12  sum_balance=1308297614  sum_vault=250000000  sum_peak=3077834547
--   max(updated_at)=2026-08-17 22:47:31.553416+00
-- AUCUNE restauration PITR lancée.

-- === public.sync_my_score ===
CREATE OR REPLACE FUNCTION public.sync_my_score(p_balance integer, p_peak_balance integer, p_hands_played integer DEFAULT 0, p_blackjacks integer DEFAULT 0, p_best_streak integer DEFAULT 0, p_highest_table text DEFAULT 'emeraude'::text, p_games_before_peak integer DEFAULT 0, p_games_played integer DEFAULT 0, p_vault integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.player_scores%rowtype;
  v_prev public.player_scores%rowtype;
  v_bal integer;
  v_peak integer;
  v_vault integer;
  v_games integer;
  v_wealth integer;
  v_prev_wealth integer;
  v_vault_delta integer;
  v_bal_delta integer;
  v_peak_catchup boolean := false;
  v_max_balance constant integer := 2_000_000_000;
  v_starting constant integer := 10_000;
  v_allowed_tables text[] := array['emeraude', 'onyx', 'imperiale', 'privee'];
  v_last_snap integer;
  v_stale boolean := false;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;
  if p_balance is null or p_balance < 0 or p_peak_balance is null or p_peak_balance < 0 then
    raise exception 'Scores invalides';
  end if;
  if p_vault is null or p_vault < 0 then
    raise exception 'vault invalide';
  end if;
  if p_games_before_peak is null or p_games_before_peak < 0 then
    raise exception 'games_before_peak invalide';
  end if;
  if p_games_played is null or p_games_played < 0 then
    raise exception 'games_played invalide';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.circle_id is not null) then
    raise exception 'Rejoins un cercle d''abord';
  end if;
  if p_highest_table is not null and not (p_highest_table = any (v_allowed_tables)) then
    raise exception 'Table invalide';
  end if;

  v_bal := least(p_balance, v_max_balance);
  v_vault := least(p_vault, v_max_balance);
  v_peak := least(greatest(p_peak_balance, p_balance + coalesce(p_vault, 0)), v_max_balance);
  v_games := p_games_played;

  select * into v_prev from public.player_scores where profile_id = v_uid for update;

  if v_prev.profile_id is not null then
    if v_games < coalesce(v_prev.games_played, 0) then
      v_stale := true;
      v_bal := v_prev.balance;
      v_vault := coalesce(v_prev.vault, 0);
      v_peak := greatest(v_peak, coalesce(v_prev.peak_balance, 0));
      v_games := coalesce(v_prev.games_played, 0);
    end if;

    if not v_stale then
      v_peak := greatest(v_peak, coalesce(v_prev.peak_balance, 0));

      v_vault_delta := v_vault - coalesce(v_prev.vault, 0);
      v_bal_delta := v_bal - coalesce(v_prev.balance, 0);
      v_prev_wealth := coalesce(v_prev.balance, 0) + coalesce(v_prev.vault, 0);
      v_wealth := v_bal + v_vault;
      -- Téléphone plus riche, pic déjà monté (sync précédente ratée).
      v_peak_catchup := false;

      if v_vault_delta > 0 and abs((-v_bal_delta) - v_vault_delta) > 1 then
        if abs(v_wealth - v_prev_wealth) <= 1 then
          null;
        else
          v_vault := coalesce(v_prev.vault, 0);
          v_bal := coalesce(v_prev.balance, 0);
          v_vault_delta := 0;
          v_bal_delta := 0;
          v_wealth := v_prev_wealth;
        end if;
      end if;

      if v_vault_delta < 0 and abs(v_bal_delta - (-v_vault_delta)) > 1 then
        v_vault := coalesce(v_prev.vault, 0);
        v_vault_delta := 0;
        v_bal_delta := v_bal - coalesce(v_prev.balance, 0);
        v_wealth := v_bal + v_vault;
      end if;

      if v_games = coalesce(v_prev.games_played, 0)
        and v_bal < coalesce(v_prev.balance, 0)
        and v_vault_delta = 0
      then
        v_bal := coalesce(v_prev.balance, 0);
        v_bal_delta := 0;
        v_wealth := v_bal + v_vault;
      end if;

      if v_bal_delta > 0
        and v_vault_delta >= 0
        and v_games <= coalesce(v_prev.games_played, 0)
        and not v_peak_catchup
      then
        if coalesce(v_prev.balance, 0) < 100
          and v_bal <= v_starting
          and v_vault_delta = 0
        then
          null;
        elsif v_bal_delta <= 3000 and v_vault_delta = 0 then
          null;
        else
          v_bal := coalesce(v_prev.balance, 0);
          v_wealth := v_bal + v_vault;
        end if;
      end if;

      if v_wealth > v_prev_wealth + 100_000
        and v_games <= coalesce(v_prev.games_played, 0)
        and not v_peak_catchup
      then
        v_bal := v_prev.balance;
        v_vault := coalesce(v_prev.vault, 0);
      end if;
    end if;
  end if;

  v_peak := least(greatest(v_peak, coalesce(v_prev.peak_balance, 0), v_bal + v_vault), v_max_balance);

  -- All-in perdue : on NE recolle PAS le pic (sinon plus personne ne perd).

  insert into public.player_scores as s (
    profile_id, balance, peak_balance, vault, hands_played, blackjacks, best_streak,
    highest_table, games_before_peak, games_played, updated_at
  ) values (
    v_uid, v_bal, v_peak, v_vault, p_hands_played, p_blackjacks, p_best_streak,
    coalesce(p_highest_table, 'emeraude'), p_games_before_peak, v_games, now()
  )
  on conflict (profile_id) do update set
    balance = excluded.balance,
    vault = excluded.vault,
    peak_balance = greatest(s.peak_balance, excluded.peak_balance, excluded.balance + coalesce(excluded.vault, 0)),
    hands_played = greatest(s.hands_played, excluded.hands_played),
    blackjacks = greatest(s.blackjacks, excluded.blackjacks),
    best_streak = greatest(s.best_streak, excluded.best_streak),
    highest_table = excluded.highest_table,
    games_played = greatest(s.games_played, excluded.games_played),
    games_before_peak = case
      when greatest(excluded.peak_balance, excluded.balance) > s.peak_balance
        then excluded.games_before_peak
      when s.games_before_peak = 0
        and excluded.games_before_peak > 0
        and greatest(excluded.peak_balance, excluded.balance) >= s.peak_balance
        then excluded.games_before_peak
      else s.games_before_peak
    end,
    updated_at = now()
  returning * into v_row;

  select cs.balance into v_last_snap
  from public.credit_snapshots cs
  where cs.profile_id = v_uid
  order by cs.recorded_at desc
  limit 1;

  if v_last_snap is null or v_last_snap is distinct from v_row.balance then
    insert into public.credit_snapshots (profile_id, balance)
    values (v_uid, v_row.balance);
  end if;

  return jsonb_build_object(
    'balance', v_row.balance,
    'peak_balance', v_row.peak_balance,
    'vault', v_row.vault,
    'games_before_peak', v_row.games_before_peak,
    'games_played', v_row.games_played,
    'updated_at', v_row.updated_at
  );
end;
$function$;

revoke all on function public.sync_my_score(integer, integer, integer, integer, integer, text, integer, integer, integer) from public;
grant execute on function public.sync_my_score(integer, integer, integer, integer, integer, text, integer, integer, integer) to authenticated, anon;

-- === public.enforce_score_invariants ===
CREATE OR REPLACE FUNCTION public.enforce_score_invariants()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
    -- Mid-mise seulement : même nombre de parties, ne pas écrire 0.
    if v_new_wealth < 100 and v_old_wealth >= 100
       and coalesce(new.games_played, 0) <= coalesce(old.games_played, 0) then
      new.balance := old.balance;
      new.vault := coalesce(old.vault, 0);
    end if;
  else
    new.peak_balance := greatest(coalesce(new.peak_balance, 0), v_new_wealth);
  end if;

  return new;
end;
$function$;

-- === public.ensure_circle_membership (LIVE prod — plus simple que #171920) ===
CREATE OR REPLACE FUNCTION public.ensure_circle_membership(p_nickname text, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_nick text := private.normalize_nickname(p_nickname);
  v_code text := private.normalize_code(p_code);
  v_circle public.circles%rowtype;
  v_profile public.profiles%rowtype;
  v_other public.profiles%rowtype;
  v_mine public.player_scores%rowtype;
  v_fresh boolean;
  v_starting constant integer := 10_000;
  v_reclaimed boolean := false;
begin
  if v_uid is null then
    raise exception 'Non authentifié';
  end if;
  if v_nick is null or char_length(v_nick) < 2 or char_length(v_nick) > 16 then
    raise exception 'Pseudo invalide (2–16 caractères)';
  end if;
  if v_code is null then
    raise exception 'Code cercle introuvable — vérifie bien les lettres (ex. EVJ ≠ EJV)';
  end if;

  select * into v_circle from public.circles where code = v_code;
  if not found then
    raise exception 'Code cercle introuvable — vérifie bien les lettres (ex. EVJ ≠ EJV)';
  end if;

  select * into v_other
  from public.profiles p
  where p.circle_id = v_circle.id
    and lower(p.nickname) = lower(v_nick)
    and p.id <> v_uid;

  if v_other.id is not null then
    select * into v_mine from public.player_scores where profile_id = v_uid;
    v_fresh := v_mine.profile_id is null
      or (
        coalesce(v_mine.games_played, 0) = 0
        and coalesce(v_mine.vault, 0) = 0
        and coalesce(v_mine.balance, 0) <= v_starting
      );
    if not v_fresh then
      raise exception 'Pseudo déjà pris dans ce cercle';
    end if;
    update public.profiles set circle_id = null where id = v_other.id;
    v_reclaimed := true;
  end if;

  insert into public.profiles (id, nickname, circle_id)
  values (v_uid, v_nick, v_circle.id)
  on conflict (id) do update
    set nickname = excluded.nickname,
        circle_id = excluded.circle_id
  returning * into v_profile;

  insert into public.player_scores (profile_id)
  values (v_uid)
  on conflict (profile_id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'profile_id', v_profile.id,
    'nickname', v_profile.nickname,
    'circle_id', v_circle.id,
    'circle_code', v_circle.code,
    'reclaimed', v_reclaimed
  );
end;
$function$;

revoke all on function public.ensure_circle_membership(text, text) from public;
grant execute on function public.ensure_circle_membership(text, text) to authenticated, anon;

-- === public.enforce_wealth_peak (trigger actif, inchangé par Phase 2a) ===
CREATE OR REPLACE FUNCTION public.enforce_wealth_peak()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.peak_balance := greatest(
    coalesce(new.peak_balance, 0),
    coalesce(new.balance, 0) + coalesce(new.vault, 0)
  );
  return new;
end;
$function$;

-- === Triggers LIVE sur public.player_scores ===
DROP TRIGGER IF EXISTS trg_player_scores_invariants ON public.player_scores;
CREATE TRIGGER trg_player_scores_invariants BEFORE INSERT OR UPDATE ON public.player_scores FOR EACH ROW EXECUTE FUNCTION enforce_score_invariants();

DROP TRIGGER IF EXISTS trg_player_scores_wealth_peak ON public.player_scores;
CREATE TRIGGER trg_player_scores_wealth_peak BEFORE INSERT OR UPDATE ON public.player_scores FOR EACH ROW EXECUTE FUNCTION enforce_wealth_peak();
