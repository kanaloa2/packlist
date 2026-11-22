import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useRecord } from '../hooks';
import { PlaceDialog } from '../components/forms';
import { Modal } from '../components/Modal';
import { Breadcrumbs, Hero, NotFound, SectionHeader } from '../components/ui';
import { addPlaceFromLibrary, createDestination, deleteLibraryPlace, ValidationError } from '../lib/repo';
import { formatDateRange } from '../lib/dates';
import { PLACE_ICONS, type LibraryPlace } from '../types';

export function LibraryPlacePage() {
  const { libraryId } = useParams();
  const lib = useRecord<LibraryPlace>('placeLibrary', libraryId);
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'edit' | 'add' | null>(null);

  const uses = useLiveQuery(async () => {
    if (!libraryId) return [];
    const placements = await db.places.where('libraryId').equals(libraryId).toArray();
    return Promise.all(
      placements.map(async (p) => ({
        place: p,
        trip: await db.trips.get(p.tripId),
        destination: await db.destinations.get(p.destinationId),
        activities: await db.activities.where('placeId').equals(p.id).count(),
      })),
    );
  }, [libraryId]);

  if (lib === undefined || !uses) return null;
  if (!lib) return <NotFound what="Place" />;
  const sorted = [...uses].sort((a, b) => (b.trip?.startDate ?? '').localeCompare(a.trip?.startDate ?? ''));

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: 'Places', to: '/library/places' }, { label: lib.name }]} />
      <Hero
        photo={lib.photo}
        icon={PLACE_ICONS[lib.type] ?? '📍'}
        kicker={lib.type}
        title={lib.name}
        subtitle={
          lib.address ? (
            <a href={`https://maps.google.com/?q=${encodeURIComponent(lib.address)}`} target="_blank" rel="noreferrer">
              {lib.address} ↗
            </a>
          ) : undefined
        }
        description={lib.description}
        actions={
          <>
            <button className="btn btn-secondary btn-small" onClick={() => setDialog('edit')}>
              Edit
            </button>
            <button className="btn btn-primary btn-small" onClick={() => setDialog('add')}>
              Add to a trip
            </button>
            <button
              className="btn btn-danger btn-small"
              onClick={async () => {
                const msg = uses.length
                  ? `Delete “${lib.name}” from your library? It stays on the ${uses.length} trip${uses.length === 1 ? '' : 's'} that use it.`
                  : `Delete “${lib.name}” from your library?`;
                if (confirm(msg)) {
                  await deleteLibraryPlace(lib.id);
                  navigate('/library/places');
                }
              }}
            >
              Delete
            </button>
          </>
        }
      />

      <SectionHeader title="On trips" count={uses.length} />
      {sorted.length === 0 ? (
        <p className="muted">Not on any trip yet. Tap “Add to a trip”, or use “+ Place” on a trip’s destination.</p>
      ) : (
        <ul className="activity-list card-list">
          {sorted.map(({ place, trip, destination, activities }) => (
            <li key={place.id}>
              <Link to={`/places/${place.id}`} className="activity-row">
                <span className="activity-main">
                  <span className="activity-name">{trip?.name ?? 'Unknown trip'}</span>
                  <span className="muted small">
                    {destination?.name}
                    {trip && ` · ${formatDateRange(trip.startDate, trip.endDate)}`}
                  </span>
                </span>
                <span className="pill">
                  {activities} activit{activities === 1 ? 'y' : 'ies'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <PlaceDialog open={dialog === 'edit'} library={lib} onClose={() => setDialog(null)} />
      <AddToTripDialog open={dialog === 'add'} lib={lib} onClose={() => setDialog(null)} onAdded={(id) => navigate(`/places/${id}`)} />
    </div>
  );
}

const NEW = '__new__';

function AddToTripDialog({ open, lib, onClose, onAdded }: { open: boolean; lib: LibraryPlace; onClose: () => void; onAdded: (placeId: string) => void }) {
  const trips = useLiveQuery(() => db.trips.orderBy('startDate').reverse().toArray(), []) ?? [];
  const [tripId, setTripId] = useState('');
  const [destId, setDestId] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const dests = useLiveQuery(() => (tripId ? db.destinations.where('tripId').equals(tripId).sortBy('createdAt') : []), [tripId]) ?? [];

  useEffect(() => {
    if (open) {
      setTripId(trips[0]?.id ?? '');
      setDestId('');
      setNewName('');
      setError('');
    }
    // Reset only when opened.
  }, [open]);

  async function add() {
    setError('');
    try {
      let target = destId;
      if (destId === NEW) {
        if (!newName.trim()) throw new ValidationError('Name the new destination.');
        target = (await createDestination(tripId, { name: newName })).id;
      }
      const p = await addPlaceFromLibrary(target, lib.id);
      onClose();
      onAdded(p.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal open={open} title={`Add ${lib.name} to a trip`} onClose={onClose}>
      <div className="form">
        {trips.length === 0 ? (
          <p className="muted">You don’t have any trips yet.</p>
        ) : (
          <>
            <div className="field">
              <label className="label" htmlFor="add-trip">
                Trip
              </label>
              <select
                id="add-trip"
                value={tripId}
                onChange={(e) => {
                  setTripId(e.target.value);
                  setDestId('');
                }}
              >
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {formatDateRange(t.startDate, t.endDate)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="add-dest">
                Destination
              </label>
              <select id="add-dest" value={destId} onChange={(e) => setDestId(e.target.value)}>
                <option value="">Choose a destination…</option>
                {dests.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
                <option value={NEW}>+ New destination…</option>
              </select>
            </div>
            {destId === NEW && (
              <div className="field">
                <label className="label" htmlFor="add-new">
                  New destination name
                </label>
                <input id="add-new" type="text" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>
            )}
          </>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!tripId || !destId} onClick={add}>
            Add
          </button>
        </div>
      </div>
    </Modal>
  );
}
