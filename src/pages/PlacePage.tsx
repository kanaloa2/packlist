import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useRecord, useTripData } from '../hooks';
import { ActivityDialog, PlaceDialog } from '../components/forms';
import { Breadcrumbs, Empty, Hero, NotFound, SectionHeader } from '../components/ui';
import { ActivityRow } from '../components/itinerary';
import { removePlaceFromTrip } from '../lib/repo';
import { MovePlaceDialog } from '../components/MovePlaceDialog';
import { PLACE_ICONS, type Place } from '../types';

export function PlacePage() {
  const { placeId } = useParams();
  const place = useRecord<Place>('places', placeId);
  const data = useTripData(place?.tripId);
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'edit' | 'activity' | 'move' | null>(null);
  const [note, setNote] = useState('');

  if (place === undefined || (place && data === undefined)) return null;
  if (!place || !data) return <NotFound what="Place" />;
  const { trip } = data;
  const dest = data.destinations.find((d) => d.id === place.destinationId);
  const activities = data.activities.filter((a) => a.placeId === place.id);

  return (
    <div className="page">
      <Breadcrumbs
        items={[
          { label: 'Trips', to: '/' },
          { label: trip.name, to: `/trips/${trip.id}` },
          { label: dest?.name ?? 'Destination', to: `/destinations/${place.destinationId}` },
          { label: place.name },
        ]}
      />
      <Hero
        photo={place.photo}
        icon={PLACE_ICONS[place.type] ?? '📍'}
        kicker={place.type}
        title={place.name}
        subtitle={
          place.address ? (
            <a href={`https://maps.google.com/?q=${encodeURIComponent(`${place.address} ${dest?.name ?? ''}`)}`} target="_blank" rel="noreferrer">
              {place.address} ↗
            </a>
          ) : (
            dest?.name
          )
        }
        description={place.description}
        actions={
          <>
            <button className="btn btn-secondary btn-small" onClick={() => setDialog('edit')}>
              Edit
            </button>
            <button className="btn btn-ghost btn-small" onClick={() => setDialog('move')}>
              Move
            </button>
            <button
              className="btn btn-danger btn-small"
              onClick={async () => {
                const n = activities.length;
                const msg =
                  `Remove “${place.name}” from ${trip.name}?` +
                  (n ? ` Its ${n} activit${n === 1 ? 'y' : 'ies'} on this trip will be deleted.` : '') +
                  ' It stays in your places library.';
                if (confirm(msg)) {
                  await removePlaceFromTrip(place.id);
                  navigate(`/destinations/${place.destinationId}`);
                }
              }}
            >
              Remove from trip
            </button>
          </>
        }
      />

      {note && (
        <p className="success" role="status">
          {note}
        </p>
      )}
      {place.libraryId && (
        <p className="muted small library-link">
          In your <Link to={`/library/places/${place.libraryId}`}>places library</Link>
        </p>
      )}

      <SectionHeader
        title="Activities"
        count={activities.length}
        action={
          <button className="btn btn-primary btn-small" onClick={() => setDialog('activity')}>
            + Activity
          </button>
        }
      />
      {activities.length === 0 ? (
        <Empty icon="🗓️" title="No activities yet">
          <p className="muted">Check in, dinner, pool time… add what you’ll do here, then pick what to wear and bring.</p>
        </Empty>
      ) : (
        <ul className="activity-list card-list">
          {activities.map((a) => (
            <li key={a.id}>
              <ActivityRow activity={a} activityItems={data.activityItems} items={data.items} />
            </li>
          ))}
        </ul>
      )}

      <PlaceDialog open={dialog === 'edit'} existing={place} onClose={() => setDialog(null)} />
      <MovePlaceDialog open={dialog === 'move'} place={place} onClose={() => setDialog(null)} onMoved={setNote} />
      <ActivityDialog
        open={dialog === 'activity'}
        placeId={place.id}
        trip={trip}
        defaultDay={activities.length ? activities[activities.length - 1].start.slice(0, 10) : undefined}
        onClose={() => setDialog(null)}
        onSaved={(id) => navigate(`/activities/${id}`)}
      />
    </div>
  );
}
