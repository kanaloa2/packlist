import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useAllItems, useRecord, useTripData } from '../hooks';
import { ActivityDialog, ItemDialog } from '../components/forms';
import { Breadcrumbs, Empty, Hero, NotFound, SectionHeader, Thumb } from '../components/ui';
import { Modal } from '../components/Modal';
import {
  addItemToActivity,
  copyActivityItems,
  deleteActivity,
  removeActivityItem,
  updateActivityItem,
} from '../lib/repo';
import { formatActivityTime } from '../lib/dates';
import { CATEGORY_ICONS, ITEM_CATEGORIES, PLACE_ICONS, type Activity, type ActivityItem, type Item, type ItemCategory } from '../types';

export function ActivityPage() {
  const { activityId } = useParams();
  const activity = useRecord<Activity>('activities', activityId);
  const data = useTripData(activity?.tripId);
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'edit' | 'pick' | 'copy' | null>(null);

  const links = useLiveQuery(
    () => (activityId ? db.activityItems.where('activityId').equals(activityId).toArray() : []),
    [activityId],
  );
  const allItems = useAllItems();

  if (activity === undefined || (activity && data === undefined) || !links || !allItems) return null;
  if (!activity || !data) return <NotFound what="Activity" />;

  const { trip } = data;
  const place = data.places.find((p) => p.id === activity.placeId);
  const dest = data.destinations.find((d) => d.id === activity.destinationId);
  const itemsById = new Map(allItems.map((i) => [i.id, i]));
  const rows = links
    .map((l) => ({ link: l, item: itemsById.get(l.itemId) }))
    .filter((r): r is { link: ActivityItem; item: Item } => !!r.item)
    .sort(
      (a, b) =>
        ITEM_CATEGORIES.indexOf(a.item.category) - ITEM_CATEGORIES.indexOf(b.item.category) ||
        a.item.name.localeCompare(b.item.name),
    );

  return (
    <div className="page">
      <Breadcrumbs
        items={[
          { label: 'Trips', to: '/' },
          { label: trip.name, to: `/trips/${trip.id}` },
          { label: dest?.name ?? 'Destination', to: `/destinations/${activity.destinationId}` },
          { label: place?.name ?? 'Place', to: `/places/${activity.placeId}` },
          { label: activity.name },
        ]}
      />
      <Hero
        photo={activity.photo}
        icon={place ? PLACE_ICONS[place.type] : '🗓️'}
        kicker={`Activity · ${place?.name ?? ''}`}
        title={activity.name}
        subtitle={formatActivityTime(activity.start, activity.end)}
        description={activity.description}
        actions={
          <>
            <button className="btn btn-secondary btn-small" onClick={() => setDialog('edit')}>
              Edit
            </button>
            <button
              className="btn btn-danger btn-small"
              onClick={async () => {
                if (confirm(`Delete “${activity.name}”? Its items stay in your library.`)) {
                  await deleteActivity(activity.id);
                  navigate(`/places/${activity.placeId}`);
                }
              }}
            >
              Delete
            </button>
          </>
        }
      />

      <SectionHeader
        title="What to wear & bring"
        count={rows.length}
        action={
          <div className="row-actions">
            {data.activities.length > 1 && (
              <button className="btn btn-ghost btn-small" onClick={() => setDialog('copy')}>
                Copy from…
              </button>
            )}
            <button className="btn btn-primary btn-small" onClick={() => setDialog('pick')}>
              + Add items
            </button>
          </div>
        }
      />

      {rows.length === 0 ? (
        <Empty icon="👕" title="No items yet">
          <p className="muted">Pick from your item library or create new ones. They’ll be added to the trip’s packing list.</p>
          <button className="btn btn-primary" onClick={() => setDialog('pick')}>
            + Add items
          </button>
        </Empty>
      ) : (
        <ul className="item-list">
          {rows.map(({ link, item }) => (
            <li key={link.id} className="item-row">
              <Link to={`/items/${item.id}`} className="item-link">
                <Thumb photo={item.photo} icon={CATEGORY_ICONS[item.category]} />
                <span>
                  <span className="item-name">{item.name}</span>
                  <span className="muted small">{item.category}</span>
                </span>
              </Link>
              <div className="item-controls">
                <div className="stepper" aria-label={`Quantity of ${item.name}`}>
                  <button
                    aria-label="Decrease quantity"
                    disabled={link.quantity <= 1}
                    onClick={() => updateActivityItem(link.id, { quantity: link.quantity - 1 })}
                  >
                    −
                  </button>
                  <span>{link.quantity}</span>
                  <button aria-label="Increase quantity" onClick={() => updateActivityItem(link.id, { quantity: link.quantity + 1 })}>
                    +
                  </button>
                </div>
                <button className="icon-btn" aria-label={`Remove ${item.name}`} onClick={() => removeActivityItem(link.id)}>
                  ✕
                </button>
              </div>
              <NoteInput link={link} />
            </li>
          ))}
        </ul>
      )}

      <p className="muted small packing-link">
        <Link to={`/trips/${trip.id}?tab=packing`}>View the trip’s packing list →</Link>
      </p>

      <ActivityDialog open={dialog === 'edit'} existing={activity} placeId={activity.placeId} trip={trip} onClose={() => setDialog(null)} />
      <ItemPicker
        open={dialog === 'pick'}
        onClose={() => setDialog(null)}
        activityId={activity.id}
        allItems={allItems}
        onActivity={new Set(links.map((l) => l.itemId))}
        tripItemIds={new Set(data.activityItems.map((l) => l.itemId))}
      />
      <CopyDialog
        open={dialog === 'copy'}
        onClose={() => setDialog(null)}
        activity={activity}
        candidates={data.activities.filter((a) => a.id !== activity.id)}
        counts={data.activityItems}
        placeName={(id) => data.places.find((p) => p.id === id)?.name ?? ''}
      />
    </div>
  );
}

function NoteInput({ link }: { link: ActivityItem }) {
  const [value, setValue] = useState(link.note);
  return (
    <input
      className="note-input"
      value={value}
      placeholder="Add a note (e.g. wear with brown belt)"
      aria-label="Note"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value !== link.note && updateActivityItem(link.id, { note: value })}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function ItemPicker({
  open,
  onClose,
  activityId,
  allItems,
  onActivity,
  tripItemIds,
}: {
  open: boolean;
  onClose: () => void;
  activityId: string;
  allItems: Item[];
  onActivity: Set<string>;
  tripItemIds: Set<string>;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ItemCategory | 'All'>('All');
  const [creating, setCreating] = useState(false);
  const [justAdded, setJustAdded] = useState<string[]>([]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    const list = allItems.filter(
      (i) =>
        (category === 'All' || i.category === category) &&
        (!q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)),
    );
    // Items already used elsewhere on this trip float to the top — you're likely to reuse them.
    return list.sort((a, b) => Number(tripItemIds.has(b.id)) - Number(tripItemIds.has(a.id)) || a.name.localeCompare(b.name));
  }, [allItems, category, q, tripItemIds]);
  const exact = allItems.some((i) => i.name.toLowerCase() === q);

  async function toggle(item: Item) {
    if (onActivity.has(item.id)) {
      const link = await db.activityItems.where('activityId').equals(activityId).filter((l) => l.itemId === item.id).first();
      if (link) await removeActivityItem(link.id);
      setJustAdded((x) => x.filter((id) => id !== item.id));
    } else {
      await addItemToActivity(activityId, item.id);
      setJustAdded((x) => [...x, item.id]);
    }
  }

  function close() {
    setQuery('');
    setJustAdded([]);
    onClose();
  }

  return (
    <>
      <Modal open={open && !creating} title="Add items" onClose={close} wide>
        <div className="picker">
          <input
            className="search"
            type="search"
            placeholder="Search your items or type a new one…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && q && !exact) {
                // Consume the key so it can't also submit the "New item" form that opens.
                e.preventDefault();
                setCreating(true);
              }
            }}
          />
          <div className="chips" role="radiogroup" aria-label="Category">
            {(['All', ...ITEM_CATEGORIES] as const).map((c) => (
              <button key={c} role="radio" aria-checked={category === c} className={`chip${category === c ? ' active' : ''}`} onClick={() => setCategory(c)}>
                {c !== 'All' && <span aria-hidden>{CATEGORY_ICONS[c]} </span>}
                {c}
              </button>
            ))}
          </div>

          <button className="btn btn-secondary create-new" onClick={() => setCreating(true)}>
            + Create {q && !exact ? `“${query.trim()}”` : 'a new item'}
          </button>

          {results.length === 0 ? (
            <p className="muted center">{allItems.length ? 'No matching items.' : 'Your item library is empty — create your first item above.'}</p>
          ) : (
            <ul className="picker-list">
              {results.map((i) => {
                const added = onActivity.has(i.id);
                return (
                  <li key={i.id}>
                    <button className={`picker-item${added ? ' added' : ''}`} onClick={() => toggle(i)} aria-pressed={added}>
                      <Thumb photo={i.photo} icon={CATEGORY_ICONS[i.category]} size="sm" />
                      <span className="picker-text">
                        <span>{i.name}</span>
                        <span className="muted small">
                          {i.category}
                          {tripItemIds.has(i.id) && ' · on this trip'}
                        </span>
                      </span>
                      <span className="picker-check" aria-hidden>
                        {added ? '✓' : '+'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="form-actions">
            <span className="muted small">{justAdded.length ? `${justAdded.length} added` : ''}</span>
            <button className="btn btn-primary" onClick={close}>
              Done
            </button>
          </div>
        </div>
      </Modal>
      <ItemDialog
        open={open && creating}
        defaultName={query.trim()}
        defaultCategory={category === 'All' ? 'Clothing' : category}
        onClose={() => setCreating(false)}
        onSaved={async (id) => {
          await addItemToActivity(activityId, id);
          setJustAdded((x) => [...x, id]);
          setQuery('');
        }}
      />
    </>
  );
}

function CopyDialog({
  open,
  onClose,
  activity,
  candidates,
  counts,
  placeName,
}: {
  open: boolean;
  onClose: () => void;
  activity: Activity;
  candidates: Activity[];
  counts: ActivityItem[];
  placeName: (id: string) => string;
}) {
  const [msg, setMsg] = useState('');
  const withItems = candidates.filter((c) => counts.some((l) => l.activityId === c.id));
  return (
    <Modal
      open={open}
      title="Copy items from another activity"
      onClose={() => {
        setMsg('');
        onClose();
      }}
    >
      {withItems.length === 0 ? (
        <p className="muted">No other activities on this trip have items yet.</p>
      ) : (
        <ul className="picker-list">
          {withItems.map((c) => {
            const n = counts.filter((l) => l.activityId === c.id).length;
            return (
              <li key={c.id}>
                <button
                  className="picker-item"
                  onClick={async () => {
                    const added = await copyActivityItems(c.id, activity.id);
                    setMsg(`Added ${added} item${added === 1 ? '' : 's'} from “${c.name}”.`);
                  }}
                >
                  <span className="picker-text">
                    <span>{c.name}</span>
                    <span className="muted small">
                      {placeName(c.placeId)} · {formatActivityTime(c.start, c.end)}
                    </span>
                  </span>
                  <span className="pill">
                    {n} item{n === 1 ? '' : 's'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {msg && (
        <p className="success" role="status">
          {msg}
        </p>
      )}
    </Modal>
  );
}
