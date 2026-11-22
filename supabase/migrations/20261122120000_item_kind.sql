-- Optional finer item type ("Jackets & coats", "Shirts", or anything the user types).
alter table public.items
  add column kind text not null default ''
  check (length(kind) <= 60);
