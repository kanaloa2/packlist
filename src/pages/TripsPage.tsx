import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { TripDialog } from '../components/forms';
import { Empty, ProgressBar, SectionHeader } from '../components/ui';
import { dayCount, formatDateRange, todayYmd } from '../lib/dates';
import { createSampleTrip } from '../lib/sample';
import type { Trip } from '../types';

interface TripSummary {
  trip: Trip;
  destinations: string[];
  activities: number;
  items: number;
  packed: number;
}

export function TripsPage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const summaries = useLiveQuery(async (): Promise<TripSummary[]> => {
    const [trips, dests, acts, activityLinks, tripLinks, statuses] = await Promise.all([
      db.trips.orderBy('startDate').toArray(),
      db.destinations.toArray(),
      db.activities.toArray(),
      db.activityItems.toArray(),
      db.tripItems.toArray(),
      db.packStatus.toArray(),
    ]);
    const links = [...activityLinks, ...tripLinks];
    return trips.map((trip) => {
      const itemIds = new Set(links.filter((l) => l.tripId === trip.id).map((l) => l.itemId));
      const packed = statuses.filter((s) => s.tripId === trip.id && s.packed && itemIds.has(s.itemId)).length;
      return {
        trip,
        destinations: dests
          .filter((d) => d.tripId === trip.id)
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((d) => d.name),
        activities: acts.filter((a) => a.tripId === trip.id).length,
        items: itemIds.size,
        packed,
      };
    });
  }, []);

  if (!summaries) return null;

  const today = todayYmd();
  const current = summaries.filter((s) => s.trip.startDate <= today && s.trip.endDate >= today);
  const upcoming = summaries.filter((s) => s.trip.startDate > today);
  const past = summaries.filter((s) => s.trip.endDate < today).reverse();

  return (
    <div className="page">
      <div className="page-title">
        <h1>Trips</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + New trip
        </button>
      </div>

      {summaries.length === 0 && (
        <Empty icon="🧳" title="No trips yet">
          <p className="muted">
            Create a trip, add destinations, places and activities, then pick the items you need for each. Packlist
            builds your packing list as you go.
          </p>
          <div className="row-actions">
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              Plan your first trip
            </button>
            <button
              className="btn btn-secondary"
              onClick={async () => navigate(`/trips/${await createSampleTrip()}`)}
            >
              Try a sample trip
            </button>
          </div>
        </Empty>
      )}

      <TripSection title="Happening now" list={current} />
      <TripSection title="Upcoming" list={upcoming} />
      <TripSection title="Past trips" list={past} />

      <TripDialog open={creating} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/trips/${id}`)} />
    </div>
  );
}

function TripSection({ title, list }: { title: string; list: TripSummary[] }) {
  if (!list.length) return null;
  return (
    <section className="section">
      <SectionHeader title={title} count={list.length} />
      <div className="card-grid">
        {list.map((s) => (
          <TripCard key={s.trip.id} s={s} />
        ))}
      </div>
    </section>
  );
}

function TripCard({ s }: { s: TripSummary }) {
  const { trip } = s;
  const pct = s.items ? Math.round((s.packed / s.items) * 100) : 0;
  const days = dayCount(trip.startDate, trip.endDate);
  return (
    <Link to={`/trips/${trip.id}`} className="card trip-card">
      {trip.photo ? (
        <img src={trip.photo} alt="" className="card-cover" />
      ) : (
        <div className="card-cover card-cover-empty" aria-hidden>
          🧳
        </div>
      )}
      <div className="card-body">
        <h3>{trip.name}</h3>
        <p className="muted">
          {formatDateRange(trip.startDate, trip.endDate)} · {days} day{days === 1 ? '' : 's'}
        </p>
        {s.destinations.length > 0 && <p className="trip-dests">📍 {s.destinations.join(' → ')}</p>}
        <div className="trip-stats">
          <span>
            {s.activities} activit{s.activities === 1 ? 'y' : 'ies'}
          </span>
          <span>
            {s.packed}/{s.items} packed
          </span>
        </div>
        {s.items > 0 && <ProgressBar percent={pct} label="Packed" />}
      </div>
    </Link>
  );
}
