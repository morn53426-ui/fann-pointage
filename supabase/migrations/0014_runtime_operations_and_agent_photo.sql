-- 0014 : compatibilité du profil agent avec les badges et activation du schéma opérationnel PostgreSQL.
-- Rejouable sur une base existante ; ne supprime aucune donnée métier.
BEGIN;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS photo_data_url text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agents'::regclass AND conname = 'agents_photo_data_url_valide'
  ) THEN
    ALTER TABLE agents ADD CONSTRAINT agents_photo_data_url_valide
      CHECK (photo_data_url IS NULL OR (length(photo_data_url) <= 110000 AND photo_data_url ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS plannings_agent_debut_runtime_idx ON plannings(agent_id, starts_at) WHERE statut <> 'annule';
CREATE INDEX IF NOT EXISTS pointages_planning_type_ts_runtime_idx ON pointages(planning_id, type, server_ts);
CREATE INDEX IF NOT EXISTS pointages_validation_ts_runtime_idx ON pointages(validation, server_ts);
CREATE INDEX IF NOT EXISTS zones_pointage_service_actif_runtime_idx ON zones_pointage(service_id, nom) WHERE actif;
CREATE INDEX IF NOT EXISTS badges_agents_agent_actif_runtime_idx ON badges_agents(agent_id, version DESC) WHERE actif;

-- Une base peut avoir les tables de classement sans ligne de règles initiales. Créer les règles provisoires conformes au domaine métier.
INSERT INTO parametres_scores(criteres, departage)
SELECT '{"taux_presence":40,"ponctualite":20,"absences_injustifiees":15,"pointages_complets":10,"anomalies":10,"hors_zone":5}'::jsonb,
       '["taux_presence","absences_injustifiees","retards","pointages_complets"]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM parametres_scores);

INSERT INTO app_schema_migrations(version) VALUES ('0014_runtime_operations_and_agent_photo')
ON CONFLICT (version) DO NOTHING;
COMMIT;
