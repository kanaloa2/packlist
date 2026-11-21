-- Packlist schema. Every row belongs to one user (user_id = auth.uid()).
-- RLS restricts every table to its owner, and composite foreign keys
-- (parent_id, user_id) guarantee a child can only reference a parent owned
-- by the same user.

create table public.trips (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  photo text,
  start_date date not null,
  end_date date not null,
  created_at bigint not null,
  updated_at bigint not null,
  unique (id, user_id),
  check (end_date >= start_date)
);

create table public.destinations (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trip_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  photo text,
  created_at bigint not null,
  updated_at bigint not null,
  unique (id, user_id),
  foreign key (trip_id, user_id) references public.trips (id, user_id) on delete cascade
);

create table public.places (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trip_id uuid not null,
  destination_id uuid not null,
  type text not null default 'Other',
  address text not null default '',
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  photo text,
  created_at bigint not null,
  updated_at bigint not null,
  unique (id, user_id),
  foreign key (trip_id, user_id) references public.trips (id, user_id) on delete cascade,
  foreign key (destination_id, user_id) references public.destinations (id, user_id) on delete cascade
);

create table public.activities (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trip_id uuid not null,
  destination_id uuid not null,
  place_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  photo text,
  -- Local wall-clock time, YYYY-MM-DDTHH:mm (kept as text so it round-trips exactly).
  start text not null check (start ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'),
  "end" text not null check ("end" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'),
  created_at bigint not null,
  updated_at bigint not null,
  unique (id, user_id),
  check ("end" >= start),
  foreign key (trip_id, user_id) references public.trips (id, user_id) on delete cascade,
  foreign key (destination_id, user_id) references public.destinations (id, user_id) on delete cascade,
  foreign key (place_id, user_id) references public.places (id, user_id) on delete cascade
);

create table public.items (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category text not null default 'Other',
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  photo text,
  created_at bigint not null,
  updated_at bigint not null,
  unique (id, user_id)
);

create table public.activity_items (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trip_id uuid not null,
  activity_id uuid not null,
  item_id uuid not null,
  quantity integer not null default 1 check (quantity >= 1),
  note text not null default '',
  created_at bigint not null,
  foreign key (trip_id, user_id) references public.trips (id, user_id) on delete cascade,
  foreign key (activity_id, user_id) references public.activities (id, user_id) on delete cascade,
  foreign key (item_id, user_id) references public.items (id, user_id) on delete cascade
);

create table public.pack_status (
  id text primary key, -- "<trip_id>:<item_id>"
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trip_id uuid not null,
  item_id uuid not null,
  packed boolean not null default false,
  check (id = trip_id::text || ':' || item_id::text),
  foreign key (trip_id, user_id) references public.trips (id, user_id) on delete cascade,
  foreign key (item_id, user_id) references public.items (id, user_id) on delete cascade
);

-- Indexes for RLS filters and foreign keys.
create index on public.trips (user_id);
create index on public.destinations (user_id);
create index on public.destinations (trip_id, user_id);
create index on public.places (user_id);
create index on public.places (trip_id, user_id);
create index on public.places (destination_id, user_id);
create index on public.activities (user_id);
create index on public.activities (trip_id, user_id);
create index on public.activities (destination_id, user_id);
create index on public.activities (place_id, user_id);
create index on public.items (user_id);
create index on public.activity_items (user_id);
create index on public.activity_items (trip_id, user_id);
create index on public.activity_items (activity_id, user_id);
create index on public.activity_items (item_id, user_id);
create index on public.pack_status (user_id);
create index on public.pack_status (trip_id, user_id);
create index on public.pack_status (item_id, user_id);

-- Row level security: owner-only access on every table, nothing for anon.
do $$
declare t text;
begin
  foreach t in array array['trips','destinations','places','activities','items','activity_items','pack_status'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format($p$create policy "Owner can read" on public.%I for select to authenticated using (user_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "Owner can insert" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "Owner can update" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "Owner can delete" on public.%I for delete to authenticated using (user_id = (select auth.uid()))$p$, t);
  end loop;
end $$;

-- Live updates across devices (Realtime respects RLS).
alter publication supabase_realtime add table
  public.trips, public.destinations, public.places, public.activities,
  public.items, public.activity_items, public.pack_status;

-- Photos: private bucket, each user may only touch files under "<their uid>/".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg']);

create policy "Users read own photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users upload own photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users update own photos" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users delete own photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
