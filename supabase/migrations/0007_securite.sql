-- 0007 : RLS, droits, vue de pointages masquée, journalisation
alter table services enable row level security;
alter table agents enable row level security;
alter table agent_affectations enable row level security;
alter table profiles enable row level security;
alter table responsable_services enable row level security;
alter table jours_feries enable row level security;
alter table parametres_regime_general enable row level security;
alter table plannings enable row level security;
alter table zones_pointage enable row level security;
alter table qr_tokens enable row level security;
alter table qr_token_uses enable row level security;
alter table pointages enable row level security;
alter table absences_anomalies enable row level security;
alter table journal_audit enable row level security;
alter table parametres_scores enable row level security;
alter table scores_mensuels enable row level security;
alter table classements_mensuels enable row level security;


-- Droits de base, puis retraits ciblés.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on pointages, qr_tokens, qr_token_uses from authenticated;
revoke insert, update, delete, truncate on journal_audit from authenticated;
revoke all on all tables in schema public from anon;

-- Lecture publique interne (tout compte actif)
create policy services_lecture on services for select to authenticated using (app_role() is not null);
create policy services_ecriture on services for all to authenticated
  using (app_role() = 'administrateur') with check (app_role() = 'administrateur');

create policy agents_lecture on agents for select to authenticated using (can_see_agent(id));
create policy agents_ecriture on agents for all to authenticated
  using (app_role() = 'administrateur') with check (app_role() = 'administrateur');

create policy affectations_lecture on agent_affectations for select to authenticated using (can_see_agent(agent_id));
create policy affectations_ecriture on agent_affectations for all to authenticated
  using (app_role() = 'administrateur' or (app_role() = 'responsable' and can_see_service(service_id)))
  with check (app_role() = 'administrateur' or (app_role() = 'responsable' and can_see_service(service_id)));

create policy profiles_lecture on profiles for select to authenticated
  using (user_id = app_user_id() or app_role() = 'administrateur');
create policy profiles_ecriture on profiles for all to authenticated
  using (app_role() = 'administrateur') with check (app_role() = 'administrateur');

create policy resp_services_lecture on responsable_services for select to authenticated
  using (user_id = app_user_id() or app_role() = 'administrateur');
create policy resp_services_ecriture on responsable_services for all to authenticated
  using (app_role() = 'administrateur') with check (app_role() = 'administrateur');

create policy feries_lecture on jours_feries for select to authenticated using (app_role() is not null);
create policy feries_ecriture on jours_feries for all to authenticated
  using (app_role() = 'administrateur') with check (app_role() = 'administrateur');
create policy param_general_lecture on parametres_regime_general for select to authenticated using (app_role() is not null);
create policy param_general_ecriture on parametres_regime_general for all to authenticated
  using (app_role() = 'administrateur') with check (app_role() = 'administrateur');

create policy plannings_lecture on plannings for select to authenticated
  using (agent_id = app_agent_id() or can_see_service(service_id));
create policy plannings_ecriture on plannings for all to authenticated
  using (app_role() = 'administrateur' or (app_role() = 'responsable' and can_see_service(service_id)))
  with check (app_role() = 'administrateur' or (app_role() = 'responsable' and can_see_service(service_id)));

-- Coordonnées des zones : accessibles seulement à l'administration et aux responsables de leurs services.
-- Les brancardiers pointent avec un QR et n'ont pas besoin d'obtenir les coordonnées des zones via l'API Supabase.
create policy zones_lecture on zones_pointage for select to authenticated
  using (app_role() = 'administrateur' or (app_role() = 'responsable' and can_see_service(service_id)));
create policy zones_ecriture on zones_pointage for all to authenticated
  using (app_role() = 'administrateur') with check (app_role() = 'administrateur');

-- Absences : l'agent signale (statut à confirmer) ; les responsables valident.
create policy absences_lecture on absences_anomalies for select to authenticated using (can_see_agent(agent_id));
create policy absences_signalement on absences_anomalies for insert to authenticated
  with check (agent_id = app_agent_id() and statut = 'a_confirmer' and valide_par is null);
create policy absences_validation on absences_anomalies for update to authenticated
  using (app_role() in ('administrateur', 'responsable') and can_see_agent(agent_id))
  with check (app_role() in ('administrateur', 'responsable') and can_see_agent(agent_id));

create policy audit_lecture on journal_audit for select to authenticated using (app_role() = 'administrateur');

-- Classement : lecture selon le rôle ; calculs/écritures réservés au serveur.
create policy param_scores_admin on parametres_scores for select to authenticated using (app_role() = 'administrateur');
create policy scores_lecture on scores_mensuels for select to authenticated
  using (app_role() in ('administrateur', 'responsable') and can_see_agent(agent_id));
-- La table contient une photographie globale en JSON : lecture brute réservée à l'administration.
-- Un responsable reçoit un classement filtré par ses services via l'API serveur, jamais ce JSON global.
create policy classements_lecture on classements_mensuels for select to authenticated
  using (app_role() = 'administrateur');
-- Les rangs mensuels sont visibles par l'équipe d'encadrement ; aucun rôle client ne peut les modifier.
-- Les tables de scores et de classements n'ont pas de politique d'écriture pour authenticated.
revoke insert, update, delete, truncate on scores_mensuels, classements_mensuels, parametres_scores from authenticated;

-- Pointages : lecture uniquement via la vue ; coordonnées exactes réservées à l'administrateur.
create view v_pointages as
select p.id, p.agent_id, p.service_id, p.planning_id, p.zone_id, p.type, p.server_ts,
       p.validation, p.motif_refus, p.source, p.statut_localisation, p.position_suspecte,
       case when app_role() = 'administrateur' then p.latitude end as latitude,
       case when app_role() = 'administrateur' then p.longitude end as longitude,
       case when app_role() in ('administrateur', 'responsable') or p.agent_id = app_agent_id() then p.distance_m end as distance_m,
       case when app_role() in ('administrateur', 'responsable') or p.agent_id = app_agent_id() then p.precision_m end as precision_m,
       p.valide_manuellement_par, p.motif_validation_manuelle
from pointages p
where p.agent_id = app_agent_id() or can_see_service(p.service_id);
grant select on v_pointages to authenticated;

-- Journalisation automatique des tables sensibles.
do $$
declare t text;
begin
  foreach t in array array[
    'services', 'agents', 'agent_affectations', 'profiles', 'responsable_services', 'jours_feries',
    'parametres_regime_general', 'plannings', 'zones_pointage', 'absences_anomalies',
    'parametres_scores', 'scores_mensuels', 'classements_mensuels'
  ] loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', 'audit_' || t, t);
  end loop;
end
$$;
create trigger audit_pointages after update on pointages for each row execute function audit_row();
