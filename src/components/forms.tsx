import { EntityDialog, type FieldDef, type Values } from './EntityDialog';
import * as repo from '../lib/repo';
import { defaultCountRule } from '../lib/counts';
import { suggestKind, typeOptions } from '../lib/itemTypes';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

export { defaultCountRule };
import { formatDate, shiftYmd, todayYmd } from '../lib/dates';
import {
  COUNT_RULES,
  COUNT_RULE_LABELS,
  type CountRule,
  CATEGORY_ICONS,
  ITEM_CATEGORIES,
  PLACE_ICONS,
  PLACE_TYPES,
  type Activity,
  type Destination,
  type Item,
  type ItemCategory,
  type Place,
  type PlaceType,
  type Trip,
} from '../types';

interface Base<T> {
  open: boolean;
  onClose: () => void;
  existing?: T;
  onSaved?: (id: string) => void;
}

const common = (v: Values) => ({ name: v.name ?? '', description: v.description ?? '', photo: v.photo });

// ---------- Trip ----------

export function TripDialog({ open, onClose, existing, onSaved }: Base<Trip>) {
  const fields: FieldDef[] = [
    { key: 'name', label: 'Trip name', type: 'text', required: true, placeholder: 'Spring break 2027', autoFocus: true },
    { key: 'startDate', label: 'Start date', type: 'date', required: true },
    { key: 'endDate', label: 'End date', type: 'date', required: true },
    { key: 'description', label: 'Description', type: 'textarea', placeholder: 'What is this trip about?' },
    { key: 'photo', label: 'Photo', type: 'photo' },
  ];
  const today = todayYmd();
  return (
    <EntityDialog
      open={open}
      onClose={onClose}
      title={existing ? 'Edit trip' : 'New trip'}
      submitLabel={existing ? 'Save' : 'Create trip'}
      fields={fields}
      initial={
        existing
          ? { ...existing }
          : { name: '', description: '', startDate: today, endDate: shiftYmd(today, 3) }
      }
      onValuesChange={(next) =>
        // Keep end date from falling before start date while editing.
        next.startDate && next.endDate && next.endDate < next.startDate ? { ...next, endDate: next.startDate } : next
      }
      onSubmit={async (v) => {
        const input = { ...common(v), startDate: v.startDate ?? '', endDate: v.endDate ?? '' };
        if (existing) {
          await repo.updateTrip(existing.id, input);
          onSaved?.(existing.id);
        } else {
          const t = await repo.createTrip(input);
          onSaved?.(t.id);
        }
      }}
    />
  );
}

// ---------- Destination ----------

export function DestinationDialog({ open, onClose, existing, onSaved, tripId }: Base<Destination> & { tripId: string }) {
  return (
    <EntityDialog
      open={open}
      onClose={onClose}
      title={existing ? 'Edit destination' : 'New destination'}
      submitLabel={existing ? 'Save' : 'Add destination'}
      fields={[
        { key: 'name', label: 'Destination', type: 'text', required: true, placeholder: 'Las Vegas', autoFocus: true },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'photo', label: 'Photo', type: 'photo' },
      ]}
      initial={existing ? { ...existing } : { name: '', description: '' }}
      onSubmit={async (v) => {
        if (existing) {
          await repo.updateDestination(existing.id, common(v));
          onSaved?.(existing.id);
        } else {
          const d = await repo.createDestination(tripId, common(v));
          onSaved?.(d.id);
        }
      }}
    />
  );
}

// ---------- Place ----------

export function PlaceDialog({ open, onClose, existing, onSaved, destinationId }: Base<Place> & { destinationId: string }) {
  return (
    <EntityDialog
      open={open}
      onClose={onClose}
      title={existing ? 'Edit place' : 'New place'}
      submitLabel={existing ? 'Save' : 'Add place'}
      fields={[
        { key: 'name', label: 'Place', type: 'text', required: true, placeholder: 'The Bellagio', autoFocus: true },
        { key: 'type', label: 'Type', type: 'select', options: PLACE_TYPES, icons: PLACE_ICONS },
        { key: 'address', label: 'Address', type: 'text', placeholder: 'Optional' },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'photo', label: 'Photo', type: 'photo' },
      ]}
      initial={existing ? { ...existing } : { name: '', description: '', type: 'Hotel', address: '' }}
      onSubmit={async (v) => {
        const input = { ...common(v), type: (v.type ?? 'Other') as PlaceType, address: v.address ?? '' };
        if (existing) {
          await repo.updatePlace(existing.id, input);
          onSaved?.(existing.id);
        } else {
          const p = await repo.createPlace(destinationId, input);
          onSaved?.(p.id);
        }
      }}
    />
  );
}

// ---------- Activity ----------

export function ActivityDialog({
  open,
  onClose,
  existing,
  onSaved,
  placeId,
  trip,
  defaultDay,
}: Base<Activity> & { placeId: string; trip: Trip; defaultDay?: string }) {
  const min = `${trip.startDate}T00:00`;
  const max = `${trip.endDate}T23:59`;
  const day = defaultDay && defaultDay >= trip.startDate && defaultDay <= trip.endDate ? defaultDay : trip.startDate;
  const hint = `Must be within the trip: ${formatDate(trip.startDate)} – ${formatDate(trip.endDate)}`;
  return (
    <EntityDialog
      open={open}
      onClose={onClose}
      title={existing ? 'Edit activity' : 'New activity'}
      submitLabel={existing ? 'Save' : 'Add activity'}
      fields={[
        { key: 'name', label: 'Activity', type: 'text', required: true, placeholder: 'Dinner, Pool time, Check in…', autoFocus: true },
        { key: 'start', label: 'Starts', type: 'datetime', required: true, min, max, hint },
        { key: 'end', label: 'Ends', type: 'datetime', required: true, min, max },
        { key: 'description', label: 'Description', type: 'textarea', placeholder: 'Dress code, reservation details…' },
        { key: 'photo', label: 'Photo', type: 'photo' },
      ]}
      initial={existing ? { ...existing } : { name: '', description: '', start: `${day}T12:00`, end: `${day}T13:00` }}
      onValuesChange={(next, prev) => {
        // Moving the start drags the end along, preserving duration.
        if (next.start && prev.start && next.start !== prev.start && next.end) {
          const dur = toMs(prev.end ?? prev.start) - toMs(prev.start);
          if (dur >= 0) return { ...next, end: fromMs(toMs(next.start) + dur) };
        }
        return next;
      }}
      onSubmit={async (v) => {
        const input = { ...common(v), start: v.start ?? '', end: v.end ?? '' };
        if (existing) {
          await repo.updateActivity(existing.id, input);
          onSaved?.(existing.id);
        } else {
          const a = await repo.createActivity(placeId, input);
          onSaved?.(a.id);
        }
      }}
    />
  );
}

function toMs(v: string) {
  return new Date(v).getTime();
}
function fromMs(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- Item ----------

export function ItemDialog({
  open,
  onClose,
  existing,
  onSaved,
  defaultName = '',
  defaultCategory = 'Clothing',
}: Base<Item> & { defaultName?: string; defaultCategory?: ItemCategory }) {
  const library = useLiveQuery(() => db.items.toArray(), []);
  const kinds = typeOptions(library ?? []);
  return (
    <EntityDialog
      open={open}
      onClose={onClose}
      title={existing ? 'Edit item' : 'New item'}
      submitLabel={existing ? 'Save' : 'Create item'}
      fields={[
        { key: 'name', label: 'Item', type: 'text', required: true, placeholder: 'Black blazer', autoFocus: true },
        { key: 'category', label: 'Category', type: 'select', options: ITEM_CATEGORIES, icons: CATEGORY_ICONS },
        {
          key: 'kind',
          label: 'Type',
          type: 'combo',
          options: kinds,
          placeholder: 'Or type your own, e.g. Workout gear',
          hint: 'Optional. Lets you group the packing list by type: shirts together, jackets together…',
        },
        {
          key: 'countRule',
          label: 'How many to pack',
          type: 'select',
          options: COUNT_RULES,
          labels: COUNT_RULE_LABELS,
          hint: 'Use “one per day” for socks and underwear: a 6-day trip packs 6. You can still change the count for any single trip on its packing list.',
        },
        { key: 'description', label: 'Description', type: 'textarea', placeholder: 'Color, size, brand…' },
        { key: 'photo', label: 'Photo', type: 'photo' },
      ]}
      initial={
        existing
          ? {
              ...existing,
              countRule: existing.countRule ?? 'trip',
              // Items made before types existed get a suggestion they can keep or clear.
              kind: existing.kind || suggestKind(existing.name),
            }
          : {
              name: defaultName,
              description: '',
              category: defaultCategory,
              kind: suggestKind(defaultName),
              countRule: defaultCountRule(defaultName, defaultCategory),
            }
      }
      onValuesChange={existing ? undefined : suggestFromName}
      onSubmit={async (v) => {
        const input = {
          ...common(v),
          category: (v.category ?? 'Other') as ItemCategory,
          countRule: (v.countRule ?? 'trip') as CountRule,
          kind: v.kind ?? '',
        };
        if (existing) {
          await repo.updateItem(existing.id, input);
          onSaved?.(existing.id);
        } else {
          const i = await repo.createItem(input);
          onSaved?.(i.id);
        }
      }}
    />
  );
}

const ruleFor = (v: Values) => defaultCountRule(v.name ?? '', (v.category ?? 'Other') as ItemCategory);

/**
 * While creating an item, keep the count rule in step with its name and category ("Socks" →
 * one per day) — but only until the user picks a rule themselves.
 */
function suggestCountRule(next: Values, prev: Values): Values {
  const userChangedRule = next.countRule !== prev.countRule;
  const ruleWasSuggested = prev.countRule === ruleFor(prev);
  return !userChangedRule && ruleWasSuggested ? { ...next, countRule: ruleFor(next) } : next;
}

/** Same idea for the type: "Navy blazer" → Jackets & coats, until the user picks a type. */
function suggestKindFromName(next: Values, prev: Values): Values {
  const userChangedKind = next.kind !== prev.kind;
  const kindWasSuggested = (prev.kind ?? '') === suggestKind(prev.name ?? '');
  return !userChangedKind && kindWasSuggested ? { ...next, kind: suggestKind(next.name ?? '') } : next;
}

function suggestFromName(next: Values, prev: Values): Values {
  return suggestKindFromName(suggestCountRule(next, prev), prev);
}
