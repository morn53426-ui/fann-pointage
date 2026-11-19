-- Références non personnelles uniquement.
-- Les services et les 54 agents réels sont créés par la migration idempotente 0013.
-- Aucun compte utilisateur de démonstration, agent fictif ou faux pointage n'est créé ici.
insert into parametres_regime_general default values on conflict do nothing;

-- Pondérations initiales à valider officiellement avant de publier un classement de production.
insert into parametres_scores (criteres)
select '{"taux_presence":40,"ponctualite":20,"absences_injustifiees":15,"pointages_complets":10,"anomalies":10,"hors_zone":5}'::jsonb
where not exists (select 1 from parametres_scores);
