-- Mobil : une garde démarre à 08 h et dure 24 h les samedis, dimanches et jours fériés.
-- Les gardes des autres jours ouvrés restent de 16 h à 08 h (16 h). Aucun planning
-- historique n'est réécrit ; la durée est validée par le moteur métier pour les nouveaux postes.
BEGIN;

ALTER TABLE plannings DROP CONSTRAINT IF EXISTS planning_coherence_regime;
ALTER TABLE plannings ADD CONSTRAINT planning_coherence_regime CHECK (
  statut <> 'prevu' OR
  (regime = 'general'  AND type_poste = 'service'         AND ends_at - starts_at BETWEEN interval '2 hours' AND interval '8 hours') OR
  (regime = 'garde'    AND type_poste = 'garde'           AND ends_at - starts_at = interval '24 hours') OR
  (regime = 'urgences' AND type_poste IN ('jour', 'nuit') AND ends_at - starts_at = interval '12 hours') OR
  (regime = 'mobil' AND type_poste = 'jour' AND ends_at - starts_at = interval '8 hours') OR
  (regime = 'mobil' AND type_poste = 'nuit' AND ends_at - starts_at IN (interval '16 hours', interval '24 hours'))
);

INSERT INTO app_schema_migrations(version) VALUES ('0026_mobil_gardes_24h_weekends_feries')
ON CONFLICT (version) DO NOTHING;
COMMIT;
