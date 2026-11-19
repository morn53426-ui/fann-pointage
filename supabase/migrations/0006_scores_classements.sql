-- 0006 : règles de score, scores mensuels et photographies de classement (sans données financières)
create table parametres_scores (
  version integer generated always as identity primary key,
  criteres jsonb not null default '{"taux_presence":40,"ponctualite":20,"absences_injustifiees":15,"pointages_complets":10,"anomalies":10,"hors_zone":5}',
  departage jsonb not null default '["taux_presence","absences_injustifiees","retards","pointages_complets"]',
  cree_par uuid references profiles(user_id),
  created_at timestamptz not null default now()
);
-- Une version des règles de score est immuable ; une nouvelle version doit être créée pour les changer.
create trigger parametres_scores_immuable before update or delete on parametres_scores
  for each row execute function forbid_change();

create table scores_mensuels (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id),
  mois date not null check (extract(day from mois) = 1),
  version_regles integer not null references parametres_scores(version),
  score_total numeric(8,3) not null check (score_total between 0 and 100),
  taux_presence numeric(5,2) not null check (taux_presence between 0 and 100),
  retards integer not null default 0 check (retards >= 0),
  -- NULL signifie que les absences injustifiées validées ne sont pas disponibles ; ne pas les assimiler à zéro.
  absences_injustifiees integer check (absences_injustifiees is null or absences_injustifiees >= 0),
  pointages_complets integer not null default 0 check (pointages_complets >= 0),
  anomalies integer not null default 0 check (anomalies >= 0),
  pointages_hors_zone integer not null default 0 check (pointages_hors_zone >= 0),
  detail jsonb not null default '{}',
  calcule_le timestamptz not null default now(),
  unique (agent_id, mois, version_regles)
);

create table classements_mensuels (
  id uuid primary key default gen_random_uuid(),
  mois date not null unique check (extract(day from mois) = 1),
  version_regles integer not null references parametres_scores(version),
  genere_le timestamptz not null default now(),
  genere_par uuid references profiles(user_id),
  regles_departage jsonb not null default '[]',
  classement jsonb not null default '[]',
  top5 jsonb not null default '[]',
  constraint classement_tableaux check (
    jsonb_typeof(classement) = 'array'
    and jsonb_typeof(top5) = 'array'
    and jsonb_array_length(top5) <= 5
  )
);
