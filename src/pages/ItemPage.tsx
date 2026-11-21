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

  if (item === undefined || !usages) return null;
  if (!item) return <NotFound what="Item" />;

  // Group usages by trip.
  const byTrip = new Map<string, Usage[]>();
  for (const u of usages) {
    const k = u.trip?.id ?? '';
    byTrip.set(k, [...(byTrip.get(k) ?? []), u]);
  }

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: 'Items', to: '/items' }, { label: item.name }]} />
      <Hero
        photo={item.photo}
        icon={CATEGORY_ICONS[item.category]}
        kicker={item.category}
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
                const msg = usages.length
                  ? `Delete “${item.name}”? It will be removed from ${usages.length} activit${usages.length === 1 ? 'y' : 'ies'}.`
                  : `Delete “${item.name}”?`;
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

      <SectionHeader title="Used on" count={usages.length} />
      {usages.length === 0 ? (
        <p className="muted">Not on any activity yet. Open an activity and tap “Add items” to use it.</p>
      ) : (
        [...byTrip.entries()].map(([tripId, list]) => (
          <section key={tripId} className="section">
            <h3 className="group-title">
              <Link to={`/trips/${tripId}`}>{list[0].trip?.name ?? 'Unknown trip'}</Link>
            </h3>
            <ul className="activity-list card-list">
              {list.map((u) => (
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
