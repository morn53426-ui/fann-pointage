-- 0009 : correctifs issus de l'audit d'octobre 2026 (testés sur PostgreSQL 16)

-- 1. Un agent ne peut pas s'attribuer lui-même un impact sur son score.
drop policy absences_signalement on absences_anomalies;
create policy absences_signalement on absences_anomalies for insert to authenticated
  with check (agent_id = app_agent_id() and statut = 'a_confirmer' and valide_par is null and impact_score = false);

-- 2. La validation d'une absence est attribuée à celui qui la fait (pas d'usurpation de valide_par).
drop policy absences_validation on absences_anomalies;
create policy absences_validation on absences_anomalies for update to authenticated
  using (app_role() in ('administrateur', 'responsable') and can_see_agent(agent_id))
  with check (app_role() in ('administrateur', 'responsable') and can_see_agent(agent_id)
              and (statut = 'a_confirmer' or valide_par = app_user_id()));

-- 3. Seuls statut, validateur, justificatif et impact peuvent changer ; l'agent et la période sont figés.
create function protect_absence() returns trigger language plpgsql as $$
begin
  if new.agent_id <> old.agent_id or new.debut <> old.debut or new.fin <> old.fin
     or new.categorie <> old.categorie or new.created_at <> old.created_at then
    raise exception 'Absence % : agent, période et catégorie sont immuables', old.id using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger absences_protegees before update on absences_anomalies
  for each row execute function protect_absence();

-- 4. Un responsable ne crée une affectation que pour un agent déjà dans son périmètre
--    (l'affectation initiale d'un agent sans service reste réservée à l'administrateur).
drop policy affectations_ecriture on agent_affectations;
create policy affectations_ecriture on agent_affectations for all to authenticated
  using (app_role() = 'administrateur' or (app_role() = 'responsable' and can_see_service(service_id)))
  with check (app_role() = 'administrateur'
              or (app_role() = 'responsable' and can_see_service(service_id) and can_see_agent(agent_id)));

-- 5. can_see_agent ignore les affectations pas encore commencées.
create or replace function can_see_agent(p_agent uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_role() = 'administrateur', false)
    or p_agent = app_agent_id()
    or exists (
      select 1 from agent_affectations a
      where a.agent_id = p_agent and a.date_debut <= current_date
        and (a.date_fin is null or a.date_fin > current_date) and can_see_service(a.service_id)
    )
$$;

-- 6. TRUNCATE interdit sur les tables d'historique (les triggers ligne ne le voient pas).
create trigger pointages_pas_de_truncate before truncate on pointages
  for each statement execute function forbid_change();
create trigger scores_pas_de_truncate before truncate on scores_mensuels
  for each statement execute function forbid_change();
create trigger classements_pas_de_truncate before truncate on classements_mensuels
  for each statement execute function forbid_change();
