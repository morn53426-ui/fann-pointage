-- 0025 : suivi du traitement des anomalies de pointage (consultée / traitée).
-- Migration additive et idempotente : aucune donnée existante n'est modifiée. Une anomalie sans ligne ici est « nouvelle ».
BEGIN;

CREATE TABLE IF NOT EXISTS anomalies_suivi (
  pointage_id uuid PRIMARY KEY REFERENCES pointages(id),
  statut text NOT NULL CHECK (statut IN ('consultee', 'traitee')),
  maj_par uuid NOT NULL REFERENCES profiles(user_id),
  maj_le timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS anomalies_suivi_statut_idx ON anomalies_suivi (statut, maj_le DESC);

ALTER TABLE anomalies_suivi ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON anomalies_suivi FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON anomalies_suivi TO service_role;

-- Les privilèges du rôle runtime sont appliqués par scripts/grant-runtime-role.sql après les migrations.

INSERT INTO app_schema_migrations(version) VALUES ('0025_anomalies_suivi')
ON CONFLICT (version) DO NOTHING;
COMMIT;
