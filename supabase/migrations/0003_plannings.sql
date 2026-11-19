-- 0003 : plannings (un poste = identifiant + instants exacts en UTC, jamais une "journée civile")
create table plannings (
  id uuid primary key default gen_random_uuid(),
  poste_id uuid not null default gen_random_uuid(),
  agent_id uuid not null references agents(id),
  service_id uuid not null references services(id),
  regime regime_code not null,
  type_poste type_poste not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  statut planning_statut not null default 'prevu',
  modifie_par uuid references profiles(user_id),
  motif text,
  remplace_planning_id uuid references plannings(id),
  created_at timestamptz not null default now(),
  constraint planning_ordre check (ends_at > starts_at),
  -- Un planning modifié ou annulé doit toujours avoir un motif.
  constraint planning_motif check (statut = 'prevu' or nullif(btrim(motif), '') is not null),
  -- Durées standard par régime (un planning "modifié" peut s'en écarter, avec motif).
  -- Les heures de début (08 h, 20 h) sont vérifiées par les moteurs de régime (Phase 3).
  constraint planning_coherence_regime check (
    statut <> 'prevu' or
    (regime = 'general'  and type_poste = 'service'          and ends_at - starts_at = interval '8 hours') or
    (regime = 'garde'    and type_poste = 'garde'            and ends_at - starts_at = interval '24 hours') or
    (regime = 'urgences' and type_poste in ('jour', 'nuit')  and ends_at - starts_at = interval '12 hours')
  ),
  -- Aucun chevauchement pour un même agent (hors plannings annulés).
  constraint planning_pas_de_chevauchement exclude using gist (
    agent_id with =, tstzrange(starts_at, ends_at, '[)') with &&
  ) where (statut <> 'annule')
);
create index plannings_service_debut on plannings (service_id, starts_at);

-- Le régime d'un planning doit correspondre à l'affectation validée de l'agent (indépendance des régimes).
create function check_planning_affectation() returns trigger language plpgsql as $$
declare jour date := (new.starts_at at time zone 'Africa/Dakar')::date;
begin
  if new.statut = 'annule' then return new; end if;
  if not exists (
    select 1 from agent_affectations a
    where a.agent_id = new.agent_id and a.service_id = new.service_id and a.regime = new.regime
      and a.date_debut <= jour and (a.date_fin is null or a.date_fin > jour)
  ) then
    raise exception 'Planning incompatible avec l''affectation validée (service/régime)' using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger plannings_affectation before insert or update on plannings
  for each row execute function check_planning_affectation();
