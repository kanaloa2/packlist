-- A per-user library of places. A place on a trip (public.places) links to a library entry,
-- so one hotel can be reused across trips and removed from a trip without being lost.
create table public.library_places (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  photo text,
  type text not null default 'Other',
  address text not null default '',
  created_at bigint not null,
  updated_at bigint not null,
  unique (id, user_id)
);
create index on public.library_places (user_id);

alter table public.library_places enable row level security;
alter table public.library_places force row level security;
revoke all on public.library_places from anon;
grant select, insert, update, delete on public.library_places to authenticated;
create policy "Owner can read" on public.library_places for select to authenticated using (user_id = (select auth.uid()));
create policy "Owner can insert" on public.library_places for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Owner can update" on public.library_places for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Owner can delete" on public.library_places for delete to authenticated using (user_id = (select auth.uid()));
alter publication supabase_realtime add table public.library_places;

-- Link trip places to the library. Deleting a library entry leaves trip places in place, unlinked.
alter table public.places add column library_id uuid;
alter table public.places
  add constraint places_library_fk foreign key (library_id, user_id)
  references public.library_places (id, user_id) on delete set null (library_id);
create index on public.places (library_id, user_id);

-- Backfill: one library entry per distinct place (same user, name and address), using the
-- most recently updated copy's details, and link every trip place to it.
create temporary table _lib on commit drop as
select gen_random_uuid() as lib_id, user_id, n, a
from (select distinct user_id, lower(trim(name)) as n, lower(trim(address)) as a from public.places) s;

insert into public.library_places (id, user_id, name, description, photo, type, address, created_at, updated_at)
select distinct on (l.lib_id) l.lib_id, p.user_id, p.name, p.description, p.photo, p.type, p.address, p.created_at, p.updated_at
from _lib l
join public.places p on p.user_id = l.user_id and lower(trim(p.name)) = l.n and lower(trim(p.address)) = l.a
order by l.lib_id, p.updated_at desc;

update public.places p
set library_id = l.lib_id
from _lib l
where p.user_id = l.user_id and lower(trim(p.name)) = l.n and lower(trim(p.address)) = l.a;
