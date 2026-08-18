-- Bootstrap Postgres local (sans Supabase) pour tests Phase 2a.
-- NE PAS exécuter en production.

create schema if not exists auth;

do $$ begin
  create role authenticated;
exception when duplicate_object then null;
end $$;

do $$ begin
  create role anon;
exception when duplicate_object then null;
end $$;

do $$ begin
  create role service_role;
exception when duplicate_object then null;
end $$;

create table if not exists auth.users (
  id uuid primary key
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('app.current_role', true), ''), 'authenticated');
$$;

create or replace function public.set_test_auth(p_uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('app.current_user_id', p_uid::text, false);
  perform set_config('app.current_role', 'authenticated', false);
end;
$$;
