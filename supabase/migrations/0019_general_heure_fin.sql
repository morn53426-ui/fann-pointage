-- Service général : un service qui termine avant 16 h a un poste plus court (de 2 h à 8 h, début 08 h).
-- Sans cette migration, la contrainte exigeait exactement 8 h et PostgreSQL refusait ces plannings.
BEGIN;

ALTER TABLE plannings DROP CONSTRAINT IF EXISTS planning_coherence_regime;
ALTER TABLE plannings ADD CONSTRAINT planning_coherence_regime CHECK (
  statut <> 'prevu' OR
  (regime = 'general'  AND type_poste = 'service'         AND ends_at - starts_at BETWEEN interval '2 hours' AND interval '8 hours') OR
  (regime = 'garde'    AND type_poste = 'garde'           AND ends_at - starts_at = interval '24 hours') OR
  (regime = 'urgences' AND type_poste IN ('jour', 'nuit') AND ends_at - starts_at = interval '12 hours') OR
  (regime = 'mobil' AND type_poste = 'jour' AND ends_at - starts_at = interval '8 hours') OR
  (regime = 'mobil' AND type_poste = 'nuit' AND ends_at - starts_at = interval '16 hours')
);

INSERT INTO app_schema_migrations(version) VALUES ('0019_general_heure_fin')
ON CONFLICT (version) DO NOTHING;
COMMIT;
