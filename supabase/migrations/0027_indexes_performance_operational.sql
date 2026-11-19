-- 0027 : index complémentaires pour l'historique, le suivi des services et les plannings.
-- Migration additive : aucun enregistrement n'est supprimé ni réécrit.
BEGIN;

-- Les historiques de pointage disposent déjà des index composites agent/service + server_ts
-- dans 0004_pointage.sql ; PostgreSQL peut les parcourir à rebours pour DESC.
-- Ne pas créer de doublons qui augmenteraient le coût des insertions de pointage.

CREATE INDEX IF NOT EXISTS plannings_service_starts_at_actifs_idx
  ON plannings (service_id, starts_at)
  WHERE statut <> 'annule';

CREATE INDEX IF NOT EXISTS affectations_agent_date_debut_desc_idx
  ON agent_affectations (agent_id, date_debut DESC);

INSERT INTO app_schema_migrations(version) VALUES ('0027_indexes_performance_operational')
ON CONFLICT (version) DO NOTHING;
COMMIT;
