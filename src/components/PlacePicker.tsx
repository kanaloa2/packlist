import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Modal } from './Modal';
import { Thumb } from './ui';
import { PlaceDialog } from './forms';
import { addPlaceFromLibrary } from '../lib/repo';
import { PLACE_ICONS, type LibraryPlace } from '../types';

/**
 * "+ Place" on a destination: pick places from your library or create a new one.
 * Places already on this trip are marked.
 */
export function PlacePicker({
  open,
  onClose,
  destinationId,
  tripId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  destinationId: string;
  tripId: string;
  /** Called with the new trip place's id after creating a brand-new place. */
  onCreated?: (placeId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const library = useLiveQuery(() => db.placeLibrary.orderBy('name').toArray(), []) ?? [];
  const onTrip = useLiveQuery(() => db.places.where('tripId').equals(tripId).toArray(), [tripId]) ?? [];
  const inThisDestination = new Set(onTrip.filter((p) => p.destinationId === destinationId).map((p) => p.libraryId));
  const elsewhereOnTrip = new Set(onTrip.filter((p) => p.destinationId !== destinationId).map((p) => p.libraryId));

  const q = query.trim().toLowerCase();
  const results = useMemo(
    () => library.filter((l) => !q || l.name.toLowerCase().includes(q) || l.address.toLowerCase().includes(q) || l.type.toLowerCase().includes(q)),
    [library, q],
  );
  const exact = library.some((l) => l.name.toLowerCase() === q);

  async function add(l: LibraryPlace) {
    await addPlaceFromLibrary(destinationId, l.id);
    setAdded((x) => [...x, l.id]);
  }

  function close() {
    setQuery('');
    setAdded([]);
    onClose();
  }

  return (
    <>
      <Modal open={open && !creating} title="Add a place" onClose={close} wide>
        <div className="picker">
          <input
            className="search"
            type="search"
            placeholder="Search your places or type a new one…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && q && !exact) {
                e.preventDefault();
                setCreating(true);
              }
            }}
          />
          <button className="btn btn-secondary create-new" onClick={() => setCreating(true)}>
            + Create {q && !exact ? `“${query.trim()}”` : 'a new place'}
          </button>
          {results.length === 0 ? (
            <p className="muted center">{library.length ? 'No matching places.' : 'Your places library is empty — create your first place above.'}</p>
          ) : (
            <ul className="picker-list">
              {results.map((l) => {
                const here = inThisDestination.has(l.id);
                return (
                  <li key={l.id}>
                    <button className={`picker-item${here ? ' added' : ''}`} disabled={here} onClick={() => add(l)} aria-pressed={here}>
                      <Thumb photo={l.photo} icon={PLACE_ICONS[l.type] ?? '📍'} size="sm" />
                      <span className="picker-text">
                        <span>{l.name}</span>
                        <span className="muted small">
                          {l.type}
                          {l.address && ` · ${l.address}`}
                          {here ? ' · in this destination' : elsewhereOnTrip.has(l.id) ? ' · elsewhere on this trip' : ''}
                        </span>
                      </span>
                      <span className="picker-check" aria-hidden>
                        {here ? '✓' : '+'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="form-actions">
            <span className="muted small">{added.length ? `${added.length} added` : ''}</span>
            <button className="btn btn-primary" onClick={close}>
              Done
            </button>
          </div>
        </div>
      </Modal>
      <PlaceDialog
        open={open && creating}
        destinationId={destinationId}
        defaultName={exact ? '' : query.trim()}
        onClose={() => setCreating(false)}
        onSaved={(placeId) => {
          setQuery('');
          close();
          onCreated?.(placeId);
        }}
      />
    </>
  );
}
