import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Modal } from './Modal';
import { createDestination, movePlace, ValidationError } from '../lib/repo';
import { formatDateRange } from '../lib/dates';
import type { Place } from '../types';

const NEW = '__new__';

/** Move a place, with its activities, to another destination on this or another trip. */
export function MovePlaceDialog({ open, onClose, place, onMoved }: { open: boolean; onClose: () => void; place: Place; onMoved?: (note: string) => void }) {
  const [tripId, setTripId] = useState(place.tripId);
  const [destId, setDestId] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const trips = useLiveQuery(() => db.trips.orderBy('startDate').reverse().toArray(), []) ?? [];
  const dests = useLiveQuery(() => db.destinations.where('tripId').equals(tripId).sortBy('createdAt'), [tripId]) ?? [];
  const activityCount = useLiveQuery(() => db.activities.where('placeId').equals(place.id).count(), [place.id]) ?? 0;

  useEffect(() => {
    if (open) {
      setTripId(place.tripId);
      setDestId('');
      setNewName('');
      setError('');
    }
  }, [open, place.tripId]);

  const choices = dests.filter((d) => d.id !== place.destinationId);
  const sortedTrips = [...trips].sort((a, b) => (a.id === place.tripId ? -1 : b.id === place.tripId ? 1 : 0));

  async function submit() {
    setBusy(true);
    setError('');
    try {
      let target = destId;
      if (destId === NEW) {
        if (!newName.trim()) throw new ValidationError('Name the new destination.');
        target = (await createDestination(tripId, { name: newName })).id;
      }
      const { shiftedDays } = await movePlace(place.id, target);
      const tripName = trips.find((t) => t.id === tripId)?.name ?? '';
      const destName = destId === NEW ? newName.trim() : dests.find((d) => d.id === target)?.name ?? '';
      onMoved?.(
        `Moved to ${destName}${tripId !== place.tripId ? ` on “${tripName}”` : ''}.` +
          (shiftedDays ? ` Activity dates moved ${Math.abs(shiftedDays)} day${Math.abs(shiftedDays) === 1 ? '' : 's'} ${shiftedDays > 0 ? 'later' : 'earlier'} to fit the trip.` : ''),
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={`Move ${place.name}`} onClose={onClose}>
      <div className="form">
        <p className="muted small">
          {activityCount
            ? activityCount === 1
              ? 'Its activity moves with it, along with that activity’s items.'
              : `Its ${activityCount} activities move with it, along with their items.`
            : 'It has no activities yet.'}{' '}
          Moving to another trip keeps activity times if they fit its dates, otherwise shifts them to line up with the
          trip’s start.
        </p>
        <div className="field">
          <label className="label" htmlFor="move-trip">
            Trip
          </label>
          <select
            id="move-trip"
            value={tripId}
            onChange={(e) => {
              setTripId(e.target.value);
              setDestId('');
            }}
          >
            {sortedTrips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.id === place.tripId ? ' (this trip)' : ` · ${formatDateRange(t.startDate, t.endDate)}`}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="move-dest">
            Destination
          </label>
          <select id="move-dest" value={destId} onChange={(e) => setDestId(e.target.value)}>
            <option value="">Choose a destination…</option>
            {choices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
            <option value={NEW}>+ New destination…</option>
          </select>
        </div>
        {destId === NEW && (
          <div className="field">
            <label className="label" htmlFor="move-new">
              New destination name
            </label>
            <input id="move-new" type="text" value={newName} placeholder="e.g. Henderson" onChange={(e) => setNewName(e.target.value)} />
          </div>
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
          <button type="button" className="btn btn-primary" disabled={busy || !destId} onClick={submit}>
            Move
          </button>
        </div>
      </div>
    </Modal>
  );
}
