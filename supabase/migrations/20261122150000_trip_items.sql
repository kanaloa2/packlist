-- Items that belong to a whole trip rather than one activity (passport, chargers…).
create table public.trip_items (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trip_id uuid not null,
  item_id uuid not null,
  quantity integer not null default 1 check (quantity >= 1),
  note text not null default '',
  created_at bigint not null,
  unique (trip_id, item_id),
  foreign key (trip_id, user_id) references public.trips (id, user_id) on delete cascade,
  foreign key (item_id, user_id) references public.items (id, user_id) on delete cascade
);

create index on public.trip_items (user_id);
create index on public.trip_items (trip_id, user_id);
create index on public.trip_items (item_id, user_id);

alter table public.trip_items enable row level security;
alter table public.trip_items force row level security;
revoke all on public.trip_items from anon;
grant select, insert, update, delete on public.trip_items to authenticated;
create policy "Owner can read" on public.trip_items for select to authenticated using (user_id = (select auth.uid()));
create policy "Owner can insert" on public.trip_items for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Owner can update" on public.trip_items for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Owner can delete" on public.trip_items for delete to authenticated using (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.trip_items;
