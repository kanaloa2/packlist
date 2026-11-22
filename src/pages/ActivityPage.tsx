import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useAllItems, useRecord, useTripData } from '../hooks';
import { ActivityDialog } from '../components/forms';
import { Breadcrumbs, Empty, Hero, NotFound, SectionHeader, Thumb } from '../components/ui';
import { ItemPicker } from '../components/ItemPicker';
import { CopyItemsDialog } from '../components/CopyItemsDialog';
import {
  addItemToActivity,
  deleteActivity,
  removeActivityItem,
  updateActivityItem,
} from '../lib/repo';
import { formatActivityTime, formatChipTime } from '../lib/dates';
import { CATEGORY_ICONS, ITEM_CATEGORIES, PLACE_ICONS, type Activity, type ActivityItem, type Item } from '../types';

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
  // For each item here, the other activities on this trip that use it too.
  const actById = new Map(data.activities.map((a) => [a.id, a]));
  const alsoOn = (itemId: string) =>
    data.activityItems
      .filter((l) => l.itemId === itemId && l.activityId !== activity.id)
      .map((l) => actById.get(l.activityId))
      .filter((a): a is Activity => !!a)
      .sort((a, b) => a.start.localeCompare(b.start));
  const onWholeTrip = new Set(data.tripItems.map((l) => l.itemId));
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
            <button className="btn btn-ghost btn-small" onClick={() => setDialog('copy')}>
              Copy items…
            </button>
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
                  <span className="muted small">{item.kind || item.category}</span>
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
              {(alsoOn(item.id).length > 0 || onWholeTrip.has(item.id)) && (
                <p className="also-on small">
                  <span className="muted">Also on this trip:</span>{' '}
                  {onWholeTrip.has(item.id) && (
                    <Link to={`/trips/${trip.id}?tab=packing`}>the whole trip</Link>
                  )}
                  {alsoOn(item.id).map((a, i) => (
                    <span key={a.id}>
                      {(i > 0 || onWholeTrip.has(item.id)) && ', '}
                      <Link to={`/activities/${a.id}`}>{a.name}</Link> <span className="muted">{formatChipTime(a.start)}</span>
                    </span>
                  ))}
                </p>
              )}
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
        allItems={allItems}
        selected={new Set(links.map((l) => l.itemId))}
        onAdd={(itemId) => addItemToActivity(activity.id, itemId)}
        onRemove={async (itemId) => {
          const link = links.find((l) => l.itemId === itemId);
          if (link) await removeActivityItem(link.id);
        }}
        tripItemIds={new Set([...data.activityItems, ...data.tripItems].map((l) => l.itemId))}
      />
      <CopyItemsDialog open={dialog === 'copy'} onClose={() => setDialog(null)} activity={activity} trip={trip} />
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
