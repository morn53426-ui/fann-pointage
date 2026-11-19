-- 0004 : zones de pointage, QR dynamiques, pointages
create table zones_pointage (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  service_id uuid not null references services(id),
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  rayon_m integer not null check (rayon_m > 0),
  precision_max_m integer not null default 50 check (precision_max_m > 0),
  hors_zone_action text not null default 'refuser' check (hors_zone_action in ('refuser', 'anomalie')),
  actif boolean not null default true,
  cree_par uuid references profiles(user_id),
  created_at timestamptz not null default now()
);

-- QR renouvelable : seul le hash est stocké. Ces tables ne sont accessibles qu'au serveur (service_role).
create table qr_tokens (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references zones_pointage(id),
  token_hash text not null unique,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint qr_expiration check (expires_at > issued_at)
);
create table qr_token_uses (
  token_id uuid not null references qr_tokens(id),
  agent_id uuid not null references agents(id),
  used_at timestamptz not null default now(),
  primary key (token_id, agent_id)  -- un même QR ne sert qu'une fois par agent
);

create table pointages (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id),
  service_id uuid not null references services(id),
  planning_id uuid references plannings(id),
  zone_id uuid references zones_pointage(id),
  type pointage_type not null,
  server_ts timestamptz not null default now(),       -- heure officielle : toujours le serveur
  validation validation_pointage not null,
  motif_refus text,
  source text not null default 'qr_pwa',
  idempotency_key text not null,
  statut_localisation statut_loc not null,
  latitude numeric(9,6) check (latitude between -90 and 90),
  longitude numeric(9,6) check (longitude between -180 and 180),
  precision_m numeric(8,1) check (precision_m is null or precision_m >= 0),
  position_collectee_le timestamptz,
  distance_m numeric(10,1) check (distance_m is null or distance_m >= 0),
  methode_loc text,
  position_suspecte boolean not null default false,
  app_version text,
  valide_manuellement_par uuid references profiles(user_id),
  motif_validation_manuelle text,
  unique (agent_id, idempotency_key),                  -- anti-doublon
  constraint coordonnees_completes check ((latitude is null) = (longitude is null)),
  constraint validation_manuelle_motif check (
    validation <> 'valide_manuellement'
    or (valide_manuellement_par is not null and nullif(btrim(motif_validation_manuelle), '') is not null)
  )
);
create index pointages_agent_ts on pointages (agent_id, server_ts);
create index pointages_service_ts on pointages (service_id, server_ts);

-- Un pointage accepté est définitif ; seuls les pointages "à vérifier" ou "refusé" peuvent être validés manuellement.
create function protect_pointage() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Suppression de pointage interdite' using errcode = '42501';
  end if;
  if old.validation not in ('a_verifier', 'refuse') then
    raise exception 'Pointage % non modifiable (statut %)', old.id, old.validation using errcode = '42501';
  end if;
  -- La modification manuelle ne peut changer QUE le statut et sa justification/auteur.
  -- Cela reste vrai pour service_role, qui contourne la RLS mais pas les triggers.
  if new.validation <> 'valide_manuellement'
     or new.valide_manuellement_par is null
     or nullif(btrim(new.motif_validation_manuelle), '') is null then
    raise exception 'Validation manuelle avec auteur et motif obligatoire' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'validation' - 'valide_manuellement_par' - 'motif_validation_manuelle')
     is distinct from
     (to_jsonb(old) - 'validation' - 'valide_manuellement_par' - 'motif_validation_manuelle') then
    raise exception 'Les données du pointage sont immuables ; seule la validation manuelle est autorisée' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger pointages_protege before update or delete on pointages
  for each row execute function protect_pointage();
