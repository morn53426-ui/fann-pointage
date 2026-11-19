-- 0001 : rôles, extensions, types, fonctions utilitaires
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$$;

create extension if not exists btree_gist;

create type regime_code as enum ('general', 'garde', 'urgences');
create type role_code as enum ('administrateur', 'responsable', 'brancardier');
create type type_poste as enum ('service', 'garde', 'jour', 'nuit');
create type planning_statut as enum ('prevu', 'modifie', 'annule');
create type pointage_type as enum ('arrivee', 'depart');
create type validation_pointage as enum ('accepte', 'refuse', 'a_verifier', 'valide_manuellement');
create type statut_loc as enum ('dans_zone', 'hors_zone', 'precision_insuffisante', 'indisponible', 'refusee', 'ancienne', 'suspecte', 'zone_inactive', 'zone_inconnue');
create type statut_absence as enum ('a_confirmer', 'justifiee', 'injustifiee', 'refusee');

-- Identifiant de l'utilisateur connecté (compatible Supabase : claim "sub" du JWT).
create function app_user_id() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

-- Table en ajout seul : toute modification ou suppression est refusée.
create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'Table % en ajout seul : % interdit', tg_table_name, tg_op using errcode = '42501';
end
$$;
