import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRecord, useTripData } from '../hooks';
import { ActivityDialog, DestinationDialog, PlaceDialog } from '../components/forms';
import { Breadcrumbs, Empty, Hero, NotFound, SectionHeader } from '../components/ui';
import { PlaceBlock } from '../components/itinerary';
import { deleteDestination } from '../lib/repo';
import type { Destination } from '../types';

export function DestinationPage() {
  const { destinationId } = useParams();
  const dest = useRecord<Destination>('destinations', destinationId);
  const data = useTripData(dest?.tripId);
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'edit' | 'place' | { placeId: string } | null>(null);

  if (dest === undefined || (dest && data === undefined)) return null;
  if (!dest || !data) return <NotFound what="Destination" />;
  const { trip } = data;
  const places = data.places.filter((p) => p.destinationId === dest.id);
  const activityCount = data.activities.filter((a) => a.destinationId === dest.id).length;

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: 'Trips', to: '/' }, { label: trip.name, to: `/trips/${trip.id}` }, { label: dest.name }]} />
      <Hero
        photo={dest.photo}
        icon="📍"
        kicker="Destination"
        title={dest.name}
        subtitle={`${places.length} place${places.length === 1 ? '' : 's'} · ${activityCount} activit${activityCount === 1 ? 'y' : 'ies'}`}
        description={dest.description}
        actions={
          <>
            <button className="btn btn-secondary btn-small" onClick={() => setDialog('edit')}>
              Edit
            </button>
            <button
              className="btn btn-danger btn-small"
              onClick={async () => {
                if (confirm(`Delete “${dest.name}” with its places and activities?`)) {
                  await deleteDestination(dest.id);
                  navigate(`/trips/${trip.id}`);
                }
              }}
            >
              Delete
            </button>
          </>
        }
      />

      <SectionHeader
        title="Places"
        count={places.length}
        action={
          <button className="btn btn-primary btn-small" onClick={() => setDialog('place')}>
            + Place
          </button>
        }
      />
      {places.length === 0 ? (
        <Empty icon="🏨" title="No places yet">
          <p className="muted">Hotels, restaurants, pools, venues — wherever your activities happen.</p>
        </Empty>
      ) : (
        <div className="itinerary">
          <section className="dest-block">
            {places.map((p) => (
              <PlaceBlock
                key={p.id}
                place={p}
                activities={data.activities.filter((a) => a.placeId === p.id)}
                activityItems={data.activityItems}
                items={data.items}
                onAddActivity={() => setDialog({ placeId: p.id })}
              />
            ))}
          </section>
        </div>
      )}

      <DestinationDialog open={dialog === 'edit'} existing={dest} tripId={trip.id} onClose={() => setDialog(null)} />
      <PlaceDialog
        open={dialog === 'place'}
        destinationId={dest.id}
        onClose={() => setDialog(null)}
        onSaved={(id) => navigate(`/places/${id}`)}
      />
      <ActivityDialog
        open={typeof dialog === 'object' && dialog !== null}
        placeId={typeof dialog === 'object' && dialog ? dialog.placeId : ''}
        trip={trip}
        onClose={() => setDialog(null)}
        onSaved={(id) => navigate(`/activities/${id}`)}
      />
    </div>
  );
}
