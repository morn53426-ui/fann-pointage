-- 0015 : registre des absences et métadonnées de décision accessibles depuis l'API Node.
-- Migration additive, rejouable et sans suppression de données historiques.
BEGIN;

ALTER TABLE absences_anomalies ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES services(id);
ALTER TABLE absences_anomalies ADD COLUMN IF NOT EXISTS cree_par uuid REFERENCES profiles(user_id);
ALTER TABLE absences_anomalies ADD COLUMN IF NOT EXISTS note_admin text;
ALTER TABLE absences_anomalies ADD COLUMN IF NOT EXISTS valide_le timestamptz;
ALTER TABLE absences_anomalies ADD COLUMN IF NOT EXISTS motif_validation text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.absences_anomalies'::regclass
      AND conname = 'absences_note_admin_longueur'
  ) THEN
    ALTER TABLE absences_anomalies ADD CONSTRAINT absences_note_admin_longueur
      CHECK (note_admin IS NULL OR length(note_admin) <= 500);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.absences_anomalies'::regclass
      AND conname = 'absences_motif_validation_longueur'
  ) THEN
    ALTER TABLE absences_anomalies ADD CONSTRAINT absences_motif_validation_longueur
      CHECK (motif_validation IS NULL OR length(motif_validation) <= 500);
  END IF;
END $$;

-- Attribuer le service historique à partir de l'affectation en vigueur au début de l'absence.
UPDATE absences_anomalies aa
SET service_id = (
  SELECT af.service_id FROM agent_affectations af
  WHERE af.agent_id = aa.agent_id
    AND af.date_debut <= (aa.debut AT TIME ZONE 'Africa/Dakar')::date
    AND (af.date_fin IS NULL OR af.date_fin > (aa.debut AT TIME ZONE 'Africa/Dakar')::date)
  ORDER BY af.date_debut DESC LIMIT 1
)
WHERE aa.service_id IS NULL;

CREATE OR REPLACE FUNCTION protect_absence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.agent_id IS DISTINCT FROM OLD.agent_id
     OR NEW.service_id IS DISTINCT FROM OLD.service_id
     OR NEW.debut IS DISTINCT FROM OLD.debut
     OR NEW.fin IS DISTINCT FROM OLD.fin
     OR NEW.categorie IS DISTINCT FROM OLD.categorie
     OR NEW.cree_par IS DISTINCT FROM OLD.cree_par
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Absence % : agent, service, période, catégorie et auteur sont immuables', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE INDEX IF NOT EXISTS absences_agent_debut_runtime_idx ON absences_anomalies(agent_id, debut DESC);
CREATE INDEX IF NOT EXISTS absences_statut_debut_runtime_idx ON absences_anomalies(statut, debut DESC);
CREATE INDEX IF NOT EXISTS absences_service_debut_runtime_idx ON absences_anomalies(service_id, debut DESC);

INSERT INTO app_schema_migrations(version) VALUES ('0015_absences_rapports_postgres')
ON CONFLICT (version) DO NOTHING;
COMMIT;
