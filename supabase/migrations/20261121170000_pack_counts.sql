-- How an item's count is worked out on a packing list, and per-trip manual counts.
alter table public.items
  add column count_rule text not null default 'trip'
  check (count_rule in ('trip', 'perDay', 'perActivity'));

-- NULL = use the automatic count; otherwise the number to pack for this trip.
alter table public.pack_status
  add column quantity integer check (quantity >= 1);
