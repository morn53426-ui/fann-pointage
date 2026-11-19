-- 0016 : informations imprimées sur le badge (profession au recto ; adresse et téléphone au verso).
-- Rejouable sur une base existante ; ne supprime ni ne modifie aucune donnée métier.
-- Les trois colonnes sont facultatives : une fiche existante reste valide sans elles.
-- Le recto affiche « Brancardier » tant qu'aucune profession n'est renseignée.
BEGIN;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS profession text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS adresse text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS telephone text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agents'::regclass AND conname = 'agents_profession_valide') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_profession_valide
      CHECK (profession IS NULL OR (length(btrim(profession)) BETWEEN 1 AND 60));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agents'::regclass AND conname = 'agents_adresse_valide') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_adresse_valide
      CHECK (adresse IS NULL OR (length(btrim(adresse)) BETWEEN 1 AND 160));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agents'::regclass AND conname = 'agents_telephone_valide') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_telephone_valide
      CHECK (telephone IS NULL OR (length(btrim(telephone)) BETWEEN 3 AND 30 AND telephone ~ '^[0-9+()./ -]+$'));
  END IF;
END $$;

INSERT INTO app_schema_migrations(version) VALUES ('0016_badge_profession_contact')
ON CONFLICT (version) DO NOTHING;
COMMIT;
