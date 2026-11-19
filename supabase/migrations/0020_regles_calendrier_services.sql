-- 0020 : calendrier ouvré du service général et régimes par défaut du catalogue.
-- Les affectations individuelles déjà renseignées ne sont pas réécrites, à l'exception
-- du régime par défaut des services ; les plannings historiques restent inchangés.
BEGIN;

-- Le régime général est travaillé du lundi au vendredi (ISO 1..5), hors jours fériés.
ALTER TABLE parametres_regime_general
  ALTER COLUMN jours_travailles SET DEFAULT '{1,2,3,4,5}';
UPDATE parametres_regime_general
  SET jours_travailles = ARRAY[1,2,3,4,5]::smallint[]
  WHERE jours_travailles = ARRAY[1,2,3,4,5,6,7]::smallint[];

-- Ces services ont le régime général comme défaut pour les nouvelles affectations.
-- Les agents qui effectuent une garde conservent leur régime explicite et leur historique.
UPDATE services
SET regime_defaut = 'general'
WHERE lower(btrim(nom)) IN (
  'kinésie', 'kinesie',
  'imagerie', 'imagerie médicale', 'imagerie medicale',
  'psychiatrie', 'cdim', 'cdim/sg', 'morgue',
  'cardiologie médicale', 'cardiologie medicale', 'cardio medical', 'cardio médical',
  'réa polyvalente', 'rea polyvalente', 'réanimation polyvalente', 'reanimation polyvalente',
  'chirurgie plastique'
);

-- Unité mobile propose deux équipes, toutes deux pilotées par le régime mobil.
UPDATE services
SET regime_defaut = 'mobil'
WHERE lower(btrim(nom)) IN ('mobile', 'mobil', 'unité mobile', 'unite mobile');

INSERT INTO app_schema_migrations(version) VALUES ('0020_regles_calendrier_services')
ON CONFLICT (version) DO NOTHING;
COMMIT;
