-- Tankrechner: Fahrgemeinschaften mit Login, Rollen (Admin/Mitfahrer), Profilen und Änderungsprotokoll
-- Im Supabase-Dashboard ausführen: SQL Editor → New query → alles einfügen → Run.
-- Das Skript kann gefahrlos mehrfach ausgeführt werden (auch über eine ältere Version).
-- Fragt der Editor nach „Row Level Security“: „Run without RLS“ wählen – das Skript schaltet RLS für alle Tabellen selbst ein.

-- ---------- Tabellen ----------

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  data jsonb not null default '{}'::jsonb,           -- gemeinsame Daten (nur Admins ändern)
  version integer not null default 0,                -- für gleichzeitige Änderungen
  invite_code text not null unique,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  display_name text,
  person_id text,                                    -- welche Person bin ich?
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.group_members add column if not exists role text not null default 'member';
do $fn$ begin
  alter table public.group_members add constraint group_members_role_check check (role in ('admin', 'member'));
exception when duplicate_object then null;
end $fn$;
-- Wer eine Fahrgemeinschaft erstellt hat, ist Admin
update public.group_members m set role = 'admin'
  from public.groups g where g.id = m.group_id and g.created_by = m.user_id and m.role <> 'admin';

-- Eigenes Profil je Mitglied: Adresse, Regelplan, einzelne Tage, „bezahlt“-Meldungen
create table if not exists public.member_profiles (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- Änderungsprotokoll (sehen nur Admins)
create table if not exists public.group_log (
  id bigserial primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  actor text,
  action text not null,
  at timestamptz not null default now()
);
create index if not exists group_log_group_at on public.group_log (group_id, at desc);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.member_profiles enable row level security;
alter table public.group_log enable row level security;

-- Zugriff für angemeldete Nutzer (was genau erlaubt ist, regeln die Policies unten).
-- Nicht angemeldete Besucher (anon) bekommen keinen Zugriff.
revoke all on public.groups, public.group_members, public.member_profiles, public.group_log from anon;
revoke update on public.group_members from authenticated;
grant select, delete on public.groups to authenticated;
grant select, delete on public.group_members to authenticated;
grant update (person_id, display_name) on public.group_members to authenticated;  -- die Rolle darf man nicht selbst ändern
grant select, insert, update on public.member_profiles to authenticated;
grant select, insert on public.group_log to authenticated;
grant usage, select on sequence public.group_log_id_seq to authenticated;

-- ---------- Hilfsfunktionen ----------

-- Kurzer Einladungscode zum Abtippen: 6 Zeichen ohne Verwechsler (kein 0/O, 1/I/L)
create or replace function public.new_invite_code() returns text
language plpgsql volatile set search_path = public as $fn$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.groups where upper(invite_code) = code);
  end loop;
  return code;
end $fn$;
alter table public.groups alter column invite_code set default public.new_invite_code();

create or replace function public.is_group_member(gid uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.group_members where group_id = gid and user_id = auth.uid());
$fn$;

create or replace function public.is_group_admin(gid uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.group_members where group_id = gid and user_id = auth.uid() and role = 'admin');
$fn$;

-- ---------- Wer darf was? ----------

drop policy if exists "Mitglieder lesen Gruppe" on public.groups;
create policy "Mitglieder lesen Gruppe" on public.groups
  for select to authenticated using (public.is_group_member(id));

drop policy if exists "Ersteller löscht Gruppe" on public.groups;
create policy "Ersteller löscht Gruppe" on public.groups
  for delete to authenticated using (created_by = auth.uid());

drop policy if exists "Mitglieder sehen Mitglieder" on public.group_members;
create policy "Mitglieder sehen Mitglieder" on public.group_members
  for select to authenticated using (public.is_group_member(group_id));

drop policy if exists "Eigene Mitgliedschaft ändern" on public.group_members;
create policy "Eigene Mitgliedschaft ändern" on public.group_members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Gruppe verlassen" on public.group_members;
drop policy if exists "Gruppe verlassen oder entfernen" on public.group_members;
create policy "Gruppe verlassen oder entfernen" on public.group_members
  for delete to authenticated using (user_id = auth.uid() or public.is_group_admin(group_id));

drop policy if exists "Mitglieder sehen Profile" on public.member_profiles;
create policy "Mitglieder sehen Profile" on public.member_profiles
  for select to authenticated using (public.is_group_member(group_id));

drop policy if exists "Eigenes Profil anlegen" on public.member_profiles;
create policy "Eigenes Profil anlegen" on public.member_profiles
  for insert to authenticated with check (user_id = auth.uid() and public.is_group_member(group_id));

drop policy if exists "Eigenes Profil ändern" on public.member_profiles;
create policy "Eigenes Profil ändern" on public.member_profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_group_member(group_id));

drop policy if exists "Protokoll schreiben" on public.group_log;
create policy "Protokoll schreiben" on public.group_log
  for insert to authenticated with check (user_id = auth.uid() and public.is_group_member(group_id));

drop policy if exists "Admins lesen Protokoll" on public.group_log;
create policy "Admins lesen Protokoll" on public.group_log
  for select to authenticated using (public.is_group_admin(group_id));

-- ---------- Funktionen ----------

drop function if exists public.create_group(text, jsonb, text, text);
create function public.create_group(p_name text, p_data jsonb, p_display_name text, p_person_id text)
returns public.groups language plpgsql security definer set search_path = public as $fn$
declare
  new_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  insert into public.groups (id, name, data, created_by)
    values (new_id, p_name, coalesce(p_data, '{}'::jsonb), auth.uid());
  insert into public.group_members (group_id, user_id, display_name, person_id, role)
    values (new_id, auth.uid(), p_display_name, p_person_id, 'admin');
  return (select t from public.groups t where t.id = new_id);
end $fn$;

-- Beitreten mit Link oder Code (Groß-/Kleinschreibung, Bindestriche und Leerzeichen egal)
create or replace function public.join_group(p_code text, p_display_name text)
returns public.groups language plpgsql security definer set search_path = public as $fn$
declare
  norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  gid uuid;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select id into gid from public.groups where upper(invite_code) = norm;
  if gid is null then raise exception 'Einladung ungültig'; end if;
  insert into public.group_members (group_id, user_id, display_name, role)
    values (gid, auth.uid(), p_display_name, 'member')
    on conflict (group_id, user_id) do nothing;
  return (select t from public.groups t where t.id = gid);
end $fn$;

-- Speichert die gemeinsamen Daten – nur Admins, und nur wenn niemand zwischendurch gespeichert hat.
-- Rückgabe: neue Version, -1 bei Konflikt.
create or replace function public.save_group(p_id uuid, p_data jsonb, p_version integer)
returns integer language plpgsql security definer set search_path = public as $fn$
declare changed_rows integer;
begin
  if not public.is_group_admin(p_id) then raise exception 'Nur Admins können das ändern'; end if;
  update public.groups set data = p_data, version = version + 1, updated_at = now()
    where id = p_id and version = p_version;
  get diagnostics changed_rows = row_count;
  if changed_rows = 0 then return -1; end if;
  return (select t.version from public.groups t where t.id = p_id);
end $fn$;

-- Rolle eines Mitglieds setzen (nur Admins; der letzte Admin kann sich nicht selbst entfernen)
create or replace function public.set_member_role(p_group uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_group_admin(p_group) then raise exception 'Nur Admins können Rollen vergeben'; end if;
  if p_role not in ('admin', 'member') then raise exception 'Unbekannte Rolle'; end if;
  if p_role = 'member' and (select count(*) from public.group_members where group_id = p_group and role = 'admin' and user_id <> p_user) = 0 then
    raise exception 'Es muss mindestens einen Admin geben';
  end if;
  update public.group_members set role = p_role where group_id = p_group and user_id = p_user;
end $fn$;

-- Neuer Einladungscode (alter Link wird ungültig)
create or replace function public.renew_invite(p_group uuid)
returns text language plpgsql security definer set search_path = public as $fn$
declare new_code text;
begin
  if not public.is_group_admin(p_group) then raise exception 'Nur Admins'; end if;
  new_code := public.new_invite_code();
  update public.groups set invite_code = new_code where id = p_group;
  return new_code;
end $fn$;

revoke execute on function public.new_invite_code() from public, anon, authenticated;
revoke execute on function public.create_group(text, jsonb, text, text) from public, anon;
revoke execute on function public.join_group(text, text) from public, anon;
revoke execute on function public.save_group(uuid, jsonb, integer) from public, anon;
revoke execute on function public.set_member_role(uuid, uuid, text) from public, anon;
revoke execute on function public.renew_invite(uuid) from public, anon;
grant execute on function public.create_group(text, jsonb, text, text) to authenticated;
grant execute on function public.join_group(text, text) to authenticated;
grant execute on function public.save_group(uuid, jsonb, integer) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.renew_invite(uuid) to authenticated;

-- ---------- Live-Aktualisierung ----------

do $fn$ begin
  alter publication supabase_realtime add table public.groups;
exception when duplicate_object then null;
end $fn$;
do $fn$ begin
  alter publication supabase_realtime add table public.member_profiles;
exception when duplicate_object then null;
end $fn$;
