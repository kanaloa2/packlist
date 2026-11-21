import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRecord, useTripData } from '../hooks';
import { ActivityDialog, PlaceDialog } from '../components/forms';
import { Breadcrumbs, Empty, Hero, NotFound, SectionHeader } from '../components/ui';
import { ActivityRow } from '../components/itinerary';
import { deletePlace } from '../lib/repo';
import { PLACE_ICONS, type Place } from '../types';

export function PlacePage() {
  const { placeId } = useParams();
  const place = useRecord<Place>('places', placeId);
  const data = useTripData(place?.tripId);
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'edit' | 'activity' | null>(null);

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
            <button
              className="btn btn-danger btn-small"
              onClick={async () => {
                if (confirm(`Delete “${place.name}” and its activities?`)) {
                  await deletePlace(place.id);
                  navigate(`/destinations/${place.destinationId}`);
                }
              }}
            >
              Delete
            </button>
          </>
        }
      />

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

      <PlaceDialog open={dialog === 'edit'} existing={place} destinationId={place.destinationId} onClose={() => setDialog(null)} />
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
