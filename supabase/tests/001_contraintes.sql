-- Tests SQL (à exécuter dans une base JETABLE après les migrations) :
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/001_contraintes.sql
-- Tout est annulé à la fin (ROLLBACK). Un échec lève une exception "ECHEC : ...".
begin;

insert into profiles (user_id, role) values ('00000000-0000-0000-0000-0000000000c1', 'administrateur');
insert into services (id, nom, regime_defaut) values
  ('00000000-0000-0000-0000-0000000000a1', 'TEST Urgences', 'urgences'),
  ('00000000-0000-0000-0000-0000000000a2', 'TEST Garde', 'garde');
insert into agents (id, nom, prenom) values
  ('00000000-0000-0000-0000-0000000000b1', 'Test', 'Un'),
  ('00000000-0000-0000-0000-0000000000b2', 'Test', 'Deux'),
  ('00000000-0000-0000-0000-0000000000b3', 'Test', 'Trois');
insert into profiles (user_id, role, agent_id) values
  ('00000000-0000-0000-0000-0000000000c2', 'brancardier', '00000000-0000-0000-0000-0000000000b1');
insert into agent_affectations (agent_id, service_id, regime, date_debut) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'urgences', '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', 'garde', '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a1', 'urgences', '2026-01-01');

-- Urgences : jour tous les deux jours ; les cycles jour/nuit sont des équipes distinctes.
insert into plannings (agent_id, service_id, regime, type_poste, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'urgences', 'jour', '2026-10-12 08:00+00', '2026-10-12 20:00+00'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'urgences', 'jour', '2026-10-14 08:00+00', '2026-10-14 20:00+00'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a1', 'urgences', 'nuit', '2026-10-12 20:00+00', '2026-10-13 08:00+00'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a1', 'urgences', 'nuit', '2026-10-13 20:00+00', '2026-10-14 08:00+00');
-- Garde de 24 h valide
insert into plannings (agent_id, service_id, regime, type_poste, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', 'garde', 'garde', '2026-10-12 08:00+00', '2026-10-13 08:00+00');

do $$ begin  -- chevauchement refusé
  begin
    insert into plannings (agent_id, service_id, regime, type_poste, starts_at, ends_at) values
      ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'urgences', 'nuit', '2026-10-12 19:00+00', '2026-10-13 07:00+00');
    raise exception 'ECHEC : chevauchement accepté';
  exception when exclusion_violation then null; end;
end $$;

do $$ begin  -- garde de 25 h refusée
  begin
    insert into plannings (agent_id, service_id, regime, type_poste, starts_at, ends_at) values
      ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', 'garde', 'garde', '2026-10-20 08:00+00', '2026-10-21 09:00+00');
    raise exception 'ECHEC : garde de 25 h acceptée';
  exception when check_violation then null; end;
end $$;

do $$ begin  -- planning urgences pour un agent en garde classique refusé (indépendance des régimes)
  begin
    insert into plannings (agent_id, service_id, regime, type_poste, starts_at, ends_at) values
      ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'urgences', 'jour', '2026-10-25 08:00+00', '2026-10-25 20:00+00');
    raise exception 'ECHEC : régime incompatible accepté';
  exception when check_violation then null; end;
end $$;

do $$ begin  -- planning modifié sans motif refusé
  begin
    insert into plannings (agent_id, service_id, regime, type_poste, starts_at, ends_at, statut) values
      ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', 'garde', 'garde', '2026-11-01 08:00+00', '2026-11-02 10:00+00', 'modifie');
    raise exception 'ECHEC : modification sans motif acceptée';
  exception when check_violation then null; end;
end $$;

-- Pointages
insert into zones_pointage (id, nom, service_id, latitude, longitude, rayon_m)
  values ('00000000-0000-0000-0000-0000000000d1', 'ZONE FICTIVE', '00000000-0000-0000-0000-0000000000a1', 14.0, -17.0, 150);
insert into pointages (id, agent_id, service_id, zone_id, type, validation, idempotency_key, statut_localisation)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-0000000000d1', 'arrivee', 'accepte', 'cle-1', 'dans_zone');

do $$ begin  -- doublon (même clé d'idempotence)
  begin
    insert into pointages (agent_id, service_id, type, validation, idempotency_key, statut_localisation)
      values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'arrivee', 'accepte', 'cle-1', 'dans_zone');
    raise exception 'ECHEC : doublon accepté';
  exception when unique_violation then null; end;
end $$;

do $$ begin  -- pointage accepté non modifiable
  begin
    update pointages set validation = 'refuse' where id = '00000000-0000-0000-0000-0000000000e1';
    raise exception 'ECHEC : pointage accepté modifié';
  exception when insufficient_privilege then null; end;
end $$;

insert into pointages (id, agent_id, service_id, zone_id, type, validation, idempotency_key, statut_localisation)
  values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-0000000000d1', 'depart', 'refuse', 'cle-refuse-1', 'hors_zone');

do $$ begin  -- une ligne refusée ne peut être transformée en pointage accepté sans motif
  begin
    update pointages set validation = 'accepte' where id = '00000000-0000-0000-0000-0000000000e2';
    raise exception 'ECHEC : statut accepté directement depuis un pointage refusé';
  exception when insufficient_privilege then null; end;
end $$;

do $$ begin  -- la validation manuelle ne peut pas falsifier l'heure du serveur
  begin
    update pointages set validation = 'valide_manuellement',
      valide_manuellement_par = '00000000-0000-0000-0000-0000000000c1',
      motif_validation_manuelle = 'Présence constatée', server_ts = server_ts + interval '1 minute'
      where id = '00000000-0000-0000-0000-0000000000e2';
    raise exception 'ECHEC : heure du pointage modifiée lors de la validation manuelle';
  exception when insufficient_privilege then null; end;
end $$;

update pointages set validation = 'valide_manuellement',
  valide_manuellement_par = '00000000-0000-0000-0000-0000000000c1',
  motif_validation_manuelle = 'Présence constatée sur le service'
  where id = '00000000-0000-0000-0000-0000000000e2';

do $$ begin  -- seul le chemin de validation manuel encadré doit fonctionner
  if (select validation from pointages where id = '00000000-0000-0000-0000-0000000000e2') <> 'valide_manuellement' then
    raise exception 'ECHEC : validation manuelle légitime non enregistrée';
  end if;
end $$;

do $$ begin  -- latitude sans longitude
  begin
    insert into pointages (agent_id, service_id, type, validation, idempotency_key, statut_localisation, latitude)
      values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'depart', 'a_verifier', 'cle-2', 'hors_zone', 14.0);
    raise exception 'ECHEC : coordonnées incomplètes acceptées';
  exception when check_violation then null; end;
end $$;

do $$ begin  -- validation manuelle sans motif
  begin
    insert into pointages (agent_id, service_id, type, validation, idempotency_key, statut_localisation, valide_manuellement_par)
      values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'depart', 'valide_manuellement', 'cle-3', 'hors_zone',
              '00000000-0000-0000-0000-0000000000c1');
    raise exception 'ECHEC : validation manuelle sans motif acceptée';
  exception when check_violation then null; end;
end $$;

-- Audit : alimenté et immuable
do $$ begin
  if (select count(*) from journal_audit) = 0 then raise exception 'ECHEC : journal vide'; end if;
  begin
    update journal_audit set action = 'X';
    raise exception 'ECHEC : journal modifiable';
  exception when insufficient_privilege then null; end;
end $$;


-- Contrat applicatif 0011 : QR consommé atomiquement avec le pointage.
insert into zones_pointage (id, nom, service_id, latitude, longitude, rayon_m)
  values ('00000000-0000-0000-0000-0000000000d2', 'ZONE GARDE FICTIVE', '00000000-0000-0000-0000-0000000000a2', 14.1, -17.1, 150);

insert into qr_tokens (id, zone_id, token_hash, issued_at, expires_at) values
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d1', 'test-hash-qr-valide', now() - interval '1 minute', now() + interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d1', 'test-hash-qr-expire', now() - interval '2 hours', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000d2', 'test-hash-qr-zone-autre', now() - interval '1 minute', now() + interval '1 hour');

insert into pointages (
  id, agent_id, service_id, planning_id, poste_code, captured_ts, zone_id, qr_token_id,
  type, validation, idempotency_key, statut_localisation, source
) values (
  '00000000-0000-0000-0000-0000000000e6',
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000a1',
  null, 'urgences:jour:2026-10-12T08:00:00.000Z', now() - interval '30 seconds',
  '00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-0000000000e3',
  'arrivee', 'a_verifier', 'cle-qr-valide', 'dans_zone', 'qr_pwa'
);

do $$ begin
  if not exists (
    select 1 from qr_token_uses
    where token_id = '00000000-0000-0000-0000-0000000000e3'
      and agent_id = '00000000-0000-0000-0000-0000000000b1'
      and used_at = (select server_ts from pointages where id = '00000000-0000-0000-0000-0000000000e6')
  ) then raise exception 'ECHEC : consommation QR absente ou non atomique'; end if;
end $$;

do $$ begin  -- le même QR et le même agent ne peuvent pas créer un second pointage
  begin
    insert into pointages (agent_id, service_id, zone_id, qr_token_id, type, validation, idempotency_key, statut_localisation)
      values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e3',
        'depart', 'a_verifier', 'cle-qr-double', 'dans_zone');
    raise exception 'ECHEC : QR réutilisé par le même agent';
  exception when unique_violation then null; end;
end $$;

do $$ begin  -- un échec de consommation ne doit pas laisser de pointage orphelin
  if exists (select 1 from pointages where idempotency_key = 'cle-qr-double') then
    raise exception 'ECHEC : un pointage a survécu à l''échec atomique du QR';
  end if;
end $$;

do $$ begin  -- QR expiré refusé par la base
  begin
    insert into pointages (agent_id, service_id, zone_id, qr_token_id, type, validation, idempotency_key, statut_localisation)
      values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e4',
        'arrivee', 'refuse', 'cle-qr-expire', 'ancienne');
    raise exception 'ECHEC : QR expiré accepté';
  exception when check_violation then null; end;
end $$;

do $$ begin  -- zone différente de celle signée dans le QR refusée par la base
  begin
    insert into pointages (agent_id, service_id, zone_id, qr_token_id, type, validation, idempotency_key, statut_localisation)
      values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e5',
        'arrivee', 'refuse', 'cle-qr-mauvaise-zone', 'dans_zone');
    raise exception 'ECHEC : QR associé à une autre zone accepté';
  exception when check_violation then null; end;
end $$;

-- Scores et classement mensuel (points seulement, sans traitement financier)
insert into parametres_scores default values;
insert into scores_mensuels (agent_id, mois, version_regles, score_total, taux_presence)
select '00000000-0000-0000-0000-0000000000b1', '2026-09-01', max(version), 95, 100 from parametres_scores;
insert into scores_mensuels (agent_id, mois, version_regles, score_total, taux_presence)
select '00000000-0000-0000-0000-0000000000b2', '2026-09-01', max(version), 82, 90 from parametres_scores;
insert into classements_mensuels (id, mois, version_regles, classement, top5)
select '00000000-0000-0000-0000-0000000000f1', '2026-09-01', max(version),
  jsonb_build_array(
    jsonb_build_object('agentId', '00000000-0000-0000-0000-0000000000b1', 'rang', 1, 'score', 95),
    jsonb_build_object('agentId', '00000000-0000-0000-0000-0000000000b2', 'rang', 2, 'score', 82)
  ),
  jsonb_build_array(jsonb_build_object('agentId', '00000000-0000-0000-0000-0000000000b1', 'rang', 1, 'score', 95))
from parametres_scores;

do $$ begin  -- un seul classement par mois
  begin
    insert into classements_mensuels (mois, version_regles, classement, top5)
    select '2026-09-01', max(version), '[]'::jsonb, '[]'::jsonb from parametres_scores;
    raise exception 'ECHEC : deux classements acceptés pour le même mois';
  exception when unique_violation then null; end;
end $$;

do $$ begin  -- le Top 5 ne peut pas contenir plus de cinq agents
  begin
    insert into classements_mensuels (mois, version_regles, classement, top5)
      select '2026-08-01', max(version), '[]'::jsonb,
        '[1,2,3,4,5,6]'::jsonb from parametres_scores;
    raise exception 'ECHEC : Top 5 de plus de cinq éléments accepté';
  exception when check_violation then null; end;
end $$;

do $$ begin  -- une photographie enregistrée du classement est immuable
  begin
    update classements_mensuels set classement = '[]'::jsonb where id = '00000000-0000-0000-0000-0000000000f1';
    raise exception 'ECHEC : photographie de classement modifiable';
  exception when insufficient_privilege then null; end;
end $$;

-- Correctifs 0009
do $$ begin  -- TRUNCATE de l'historique des pointages interdit
  begin truncate pointages, anomalies_suivi; raise exception 'ECHEC : TRUNCATE pointages accepté';
  exception when insufficient_privilege then null; end;
end $$;

insert into absences_anomalies (id, agent_id, debut, fin, categorie)
  values ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000b1', now(), now(), 'maladie');
do $$ begin  -- une absence ne peut pas changer d'agent
  begin
    update absences_anomalies set agent_id = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-0000000000a9';
    raise exception 'ECHEC : agent d''une absence modifiable';
  exception when insufficient_privilege then null; end;
end $$;

create role t_brancardier nologin; grant authenticated to t_brancardier;
do $$ begin  -- un brancardier ne peut pas s'attribuer un impact_score, ni usurper une validation
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2"}', true);
  set local role authenticated;
  begin
    insert into absences_anomalies (agent_id, debut, fin, categorie, impact_score)
      values ('00000000-0000-0000-0000-0000000000b1', now(), now(), 'maladie', true);
    raise exception 'ECHEC : impact_score accepté à l''insertion';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;


rollback;
select 'TESTS SQL OK' as resultat;
