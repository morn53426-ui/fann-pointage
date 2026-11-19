-- Règles du service Mobil : jour 08 h–16 h, nuit 16 h–08 h le lendemain.
-- Les plannings historiques restent inchangés ; seules les affectations ouvertes du service Mobile évoluent.
BEGIN;

ALTER TABLE plannings DROP CONSTRAINT IF EXISTS planning_coherence_regime;
ALTER TABLE plannings ADD CONSTRAINT planning_coherence_regime CHECK (
  statut <> 'prevu' OR
  (regime = 'general'  AND type_poste = 'service'         AND ends_at - starts_at = interval '8 hours') OR
  (regime = 'garde'    AND type_poste = 'garde'           AND ends_at - starts_at = interval '24 hours') OR
  (regime = 'urgences' AND type_poste IN ('jour', 'nuit') AND ends_at - starts_at = interval '12 hours') OR
  (regime = 'mobil' AND type_poste = 'jour' AND ends_at - starts_at = interval '8 hours') OR
  (regime = 'mobil' AND type_poste = 'nuit' AND ends_at - starts_at = interval '16 hours')
);

UPDATE services SET regime_defaut = 'mobil'
WHERE lower(btrim(nom)) IN ('mobile', 'mobil', 'unité mobile');

UPDATE agent_affectations aa SET regime = 'mobil'
FROM services s
WHERE s.id = aa.service_id
  AND lower(btrim(s.nom)) IN ('mobile', 'mobil', 'unité mobile')
  AND aa.regime = 'garde'
  AND aa.date_fin IS NULL;

INSERT INTO app_schema_migrations(version) VALUES ('0018_planning_mobil_rules')
ON CONFLICT (version) DO NOTHING;
COMMIT;
