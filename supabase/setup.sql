-- Tankrechner: Fahrgemeinschaften mit Login
-- Einmal im Supabase-Dashboard ausführen: SQL Editor → New query → alles einfügen → Run.
-- Das Skript kann gefahrlos mehrfach ausgeführt werden.

-- ---------- Tabellen ----------

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  data jsonb not null default '{}'::jsonb,           -- gemeinsame Daten der Fahrgemeinschaft
  version integer not null default 0,                -- für gleichzeitige Änderungen
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  display_name text,
  person_id text,                                    -- welche Person im Tankrechner bin ich?
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

-- Zugriff für angemeldete Nutzer (was genau erlaubt ist, regeln die Policies unten).
-- Nicht angemeldete Besucher (anon) bekommen keinen Zugriff.
grant select, delete on public.groups to authenticated;
grant select, update, delete on public.group_members to authenticated;
revoke all on public.groups from anon;
revoke all on public.group_members from anon;

-- ---------- Wer darf was? ----------

create or replace function public.is_group_member(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = gid and user_id = auth.uid());
$$;

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
create policy "Gruppe verlassen" on public.group_members
  for delete to authenticated using (user_id = auth.uid());

-- Anlegen, Beitreten und Speichern nur über diese Funktionen:

create or replace function public.create_group(p_name text, p_data jsonb, p_display_name text, p_person_id text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  insert into public.groups (name, data, created_by)
    values (p_name, coalesce(p_data, '{}'::jsonb), auth.uid()) returning * into g;
  insert into public.group_members (group_id, user_id, display_name, person_id)
    values (g.id, auth.uid(), p_display_name, p_person_id);
  return g;
end $$;

create or replace function public.join_group(p_code text, p_display_name text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select * into g from public.groups where invite_code = p_code;
  if not found then raise exception 'Einladung ungültig'; end if;
  insert into public.group_members (group_id, user_id, display_name)
    values (g.id, auth.uid(), p_display_name)
    on conflict (group_id, user_id) do nothing;
  return g;
end $$;

-- Speichert nur, wenn niemand zwischendurch gespeichert hat. Rückgabe: neue Version, -1 bei Konflikt.
create or replace function public.save_group(p_id uuid, p_data jsonb, p_version integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  if not public.is_group_member(p_id) then raise exception 'Kein Mitglied dieser Fahrgemeinschaft'; end if;
  update public.groups set data = p_data, version = version + 1, updated_at = now()
    where id = p_id and version = p_version
    returning version into v;
  return coalesce(v, -1);
end $$;

revoke execute on function public.create_group(text, jsonb, text, text) from public, anon;
revoke execute on function public.join_group(text, text) from public, anon;
revoke execute on function public.save_group(uuid, jsonb, integer) from public, anon;
grant execute on function public.create_group(text, jsonb, text, text) to authenticated;
grant execute on function public.join_group(text, text) to authenticated;
grant execute on function public.save_group(uuid, jsonb, integer) to authenticated;

-- ---------- Live-Aktualisierung ----------

do $$ begin
  alter publication supabase_realtime add table public.groups;
exception when duplicate_object then null;
end $$;
