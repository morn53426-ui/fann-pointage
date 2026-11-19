-- 0022 : destinataires ciblés pour la messagerie (comptes précis ou service).
-- Migration additive et idempotente : les messages 0021 restent des diffusions générales.
BEGIN;

ALTER TABLE messages_diffusion
  ADD COLUMN IF NOT EXISTS portee text NOT NULL DEFAULT 'tous',
  ADD COLUMN IF NOT EXISTS priorite text NOT NULL DEFAULT 'normale';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.messages_diffusion'::regclass AND conname='messages_diffusion_portee_valide') THEN
    ALTER TABLE messages_diffusion ADD CONSTRAINT messages_diffusion_portee_valide CHECK (portee IN ('tous','comptes','services'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.messages_diffusion'::regclass AND conname='messages_diffusion_priorite_valide') THEN
    ALTER TABLE messages_diffusion ADD CONSTRAINT messages_diffusion_priorite_valide CHECK (priorite IN ('normale','urgente'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS messages_destinataires (
  message_id uuid NOT NULL REFERENCES messages_diffusion(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS messages_destinataires_user_idx ON messages_destinataires (user_id, message_id);

CREATE TABLE IF NOT EXISTS messages_services_destinataires (
  message_id uuid NOT NULL REFERENCES messages_diffusion(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  PRIMARY KEY (message_id, service_id)
);
CREATE INDEX IF NOT EXISTS messages_services_destinataires_service_idx ON messages_services_destinataires (service_id, message_id);

ALTER TABLE messages_destinataires ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages_services_destinataires ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON messages_destinataires, messages_services_destinataires FROM anon, authenticated;
GRANT SELECT, INSERT ON messages_destinataires TO service_role;
GRANT SELECT, INSERT ON messages_services_destinataires TO service_role;

INSERT INTO app_schema_migrations(version) VALUES ('0022_messagerie_destinataires')
ON CONFLICT (version) DO NOTHING;
COMMIT;
