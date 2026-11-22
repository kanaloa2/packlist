import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useRecord } from '../hooks';
import { ItemDialog } from '../components/forms';
import { Breadcrumbs, Hero, NotFound, SectionHeader } from '../components/ui';
import { deleteItem } from '../lib/repo';
import { formatActivityTime } from '../lib/dates';
import { CATEGORY_ICONS, COUNT_RULE_LABELS, type Activity, type Item, type Place, type Trip } from '../types';

interface Usage {
  activity: Activity;
  place?: Place;
  trip?: Trip;
  quantity: number;
  note: string;
}

export function ItemPage() {
  const { itemId } = useParams();
  const item = useRecord<Item>('items', itemId);
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  const usages = useLiveQuery(async (): Promise<Usage[]> => {
    if (!itemId) return [];
    const links = await db.activityItems.where('itemId').equals(itemId).toArray();
    const acts = await db.activities.bulkGet(links.map((l) => l.activityId));
    const places = await db.places.bulkGet(acts.map((a) => a?.placeId ?? ''));
    const trips = await db.trips.bulkGet(acts.map((a) => a?.tripId ?? ''));
    return links
      .map((l, i) => ({ activity: acts[i]!, place: places[i], trip: trips[i], quantity: l.quantity, note: l.note }))
      .filter((u) => !!u.activity)
      .sort((a, b) => b.activity.start.localeCompare(a.activity.start));
  }, [itemId]);

  // Trips this item is added to as a whole (not via an activity).
  const wholeTrips = useLiveQuery(async () => {
    if (!itemId) return [];
    const links = await db.tripItems.where('itemId').equals(itemId).toArray();
    const trips = await db.trips.bulkGet(links.map((l) => l.tripId));
    return links.map((l, i) => ({ link: l, trip: trips[i] })).filter((x): x is { link: typeof x.link; trip: Trip } => !!x.trip);
  }, [itemId]);

  if (item === undefined || !usages || !wholeTrips) return null;
  if (!item) return <NotFound what="Item" />;

  // Group usages by trip, including trips it's on as a whole-trip item.
  const byTrip = new Map<string, { name: string; usages: Usage[]; whole?: { quantity: number; note: string } }>();
  for (const u of usages) {
    const k = u.trip?.id ?? '';
    const g = byTrip.get(k) ?? { name: u.trip?.name ?? 'Unknown trip', usages: [] };
    g.usages.push(u);
    byTrip.set(k, g);
  }
  for (const { link, trip } of wholeTrips) {
    const g = byTrip.get(trip.id) ?? { name: trip.name, usages: [] };
    g.whole = { quantity: link.quantity, note: link.note };
    byTrip.set(trip.id, g);
  }
  const uses = usages.length + wholeTrips.length;

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: 'Items', to: '/items' }, { label: item.name }]} />
      <Hero
        photo={item.photo}
        icon={CATEGORY_ICONS[item.category]}
        kicker={item.kind ? `${item.category} · ${item.kind}` : item.category}
        title={item.name}
        subtitle={`Packing count: ${COUNT_RULE_LABELS[item.countRule ?? 'trip'].toLowerCase()}`}
        description={item.description}
        actions={
          <>
            <button className="btn btn-secondary btn-small" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              className="btn btn-danger btn-small"
              onClick={async () => {
                const where = [
                  usages.length && `${usages.length} activit${usages.length === 1 ? 'y' : 'ies'}`,
                  wholeTrips.length && `${wholeTrips.length} trip${wholeTrips.length === 1 ? '' : 's'}`,
                ].filter(Boolean);
                const msg = where.length ? `Delete “${item.name}”? It will be removed from ${where.join(' and ')}.` : `Delete “${item.name}”?`;
                if (confirm(msg)) {
                  await deleteItem(item.id);
                  navigate('/items');
                }
              }}
            >
              Delete
            </button>
          </>
        }
      />

      <SectionHeader title="Used on" count={uses} />
      {uses === 0 ? (
        <p className="muted">
          Not used yet. Add it to an activity (“Add items”) or to a whole trip (“+ Whole trip” on the packing list).
        </p>
      ) : (
        [...byTrip.entries()].map(([tripId, g]) => (
          <section key={tripId} className="section">
            <h3 className="group-title">
              <Link to={`/trips/${tripId}`}>{g.name}</Link>
            </h3>
            <ul className="activity-list card-list">
              {g.whole && (
                <li>
                  <Link to={`/trips/${tripId}?tab=packing`} className="activity-row">
                    <span className="activity-main">
                      <span className="activity-name">Whole trip</span>
                      <span className="muted small">Not tied to one activity{g.whole.note && ` · ${g.whole.note}`}</span>
                    </span>
                    {g.whole.quantity > 1 && <span className="pill">×{g.whole.quantity}</span>}
                  </Link>
                </li>
              )}
              {g.usages.map((u) => (
                <li key={u.activity.id}>
                  <Link to={`/activities/${u.activity.id}`} className="activity-row">
                    <span className="activity-main">
                      <span className="activity-name">{u.activity.name}</span>
                      <span className="muted small">
                        {u.place?.name} · {formatActivityTime(u.activity.start, u.activity.end)}
                        {u.note && ` · ${u.note}`}
                      </span>
                    </span>
                    {u.quantity > 1 && <span className="pill">×{u.quantity}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <ItemDialog open={editing} existing={item} onClose={() => setEditing(false)} />
    </div>
  );
}
