-- 0002 : services, agents, affectations (avec historique), comptes, jours fériés
create table services (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique,
  -- Pas de valeur par défaut : le régime d'un nouveau service est toujours choisi explicitement.
  regime_defaut regime_code not null,
  actif boolean not null default true,
  responsable_user_id uuid,
  created_at timestamptz not null default now()
);

create table agents (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  prenom text not null,
  matricule text unique,
  actif boolean not null default true,
  localisation_consentement boolean not null default false,
  localisation_consentement_at timestamptz,
  created_at timestamptz not null default now()
);

-- Une seule affectation validée à la fois par agent ; l'historique est conservé.
create table agent_affectations (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id),
  service_id uuid not null references services(id),
  regime regime_code not null,
  date_debut date not null,
  date_fin date,
  valide_par uuid,
  motif text,
  created_at timestamptz not null default now(),
  constraint affectation_dates check (date_fin is null or date_fin > date_debut),
  constraint affectation_pas_de_chevauchement exclude using gist (
    agent_id with =, daterange(date_debut, date_fin, '[)') with &&
  )
);

-- user_id correspond à auth.users(id) sur Supabase (pas de clé étrangère pour rester portable).
create table profiles (
  user_id uuid primary key,
  role role_code not null,
  agent_id uuid unique references agents(id),
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  constraint profil_brancardier_agent check (role <> 'brancardier' or agent_id is not null)
);

alter table services add constraint services_responsable_fk
  foreign key (responsable_user_id) references profiles(user_id);
alter table agent_affectations add constraint affectation_valide_par_fk
  foreign key (valide_par) references profiles(user_id);

create table responsable_services (
  user_id uuid not null references profiles(user_id),
  service_id uuid not null references services(id),
  primary key (user_id, service_id)
);

create table jours_feries (
  id uuid primary key default gen_random_uuid(),
  date_ferie date not null unique,
  libelle text not null,
  actif boolean not null default true
);

-- Paramètres du régime A uniquement. Le service général travaille tous les jours hors jours fériés déclarés.
create table parametres_regime_general (
  id boolean primary key default true check (id),
  jours_travailles smallint[] not null default '{1,2,3,4,5,6,7}',
  heure_debut time not null default '08:00',
  heure_fin time not null default '16:00'
);

-- Fonctions d'autorisation (utilisées par les politiques RLS)
create function app_role() returns role_code language sql stable security definer set search_path = public as $$
  select role from profiles where user_id = app_user_id() and actif
$$;

create function app_agent_id() returns uuid language sql stable security definer set search_path = public as $$
  select agent_id from profiles where user_id = app_user_id() and actif
$$;

create function can_see_service(p_service uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_role() = 'administrateur', false)
    or exists (
      select 1 from responsable_services rs
      join profiles p on p.user_id = rs.user_id
      where rs.user_id = app_user_id() and rs.service_id = p_service and p.actif and p.role = 'responsable'
    )
$$;

create function can_see_agent(p_agent uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_role() = 'administrateur', false)
    or p_agent = app_agent_id()
    or exists (
      select 1 from agent_affectations a
      where a.agent_id = p_agent and (a.date_fin is null or a.date_fin > current_date) and can_see_service(a.service_id)
    )
$$;
