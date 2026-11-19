-- 0005 : absences/anomalies et journal d'audit (ajout seul)
create table absences_anomalies (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id),
  debut timestamptz not null,
  fin timestamptz not null,
  categorie text not null,
  justificatif_ref text,
  statut statut_absence not null default 'a_confirmer',
  valide_par uuid references profiles(user_id),
  impact_score boolean not null default false,
  created_at timestamptz not null default now(),
  constraint absence_periode check (fin >= debut),
  constraint absence_validation check (statut = 'a_confirmer' or valide_par is not null)
);

create table journal_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  action text not null,
  objet_table text not null,
  objet_id text,
  ancienne_valeur jsonb,
  nouvelle_valeur jsonb,
  motif text,
  ip text
);
create trigger audit_immuable before update or delete on journal_audit
  for each row execute function forbid_change();
create trigger audit_pas_de_truncate before truncate on journal_audit
  for each statement execute function forbid_change();

-- Trigger générique : écrit chaque changement dans le journal (motif lu dans app.motif, IP dans app.ip).
create function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into journal_audit (user_id, action, objet_table, objet_id, ancienne_valeur, nouvelle_valeur, motif, ip)
  values (
    app_user_id(), tg_op, tg_table_name, coalesce(j ->> 'id', j ->> 'user_id'),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    nullif(current_setting('app.motif', true), ''),
    nullif(current_setting('app.ip', true), '')
  );
  return null;
end
$$;
