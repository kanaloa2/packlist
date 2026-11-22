import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { PlaceDialog } from '../components/forms';
import { Empty, Thumb } from '../components/ui';
import { PLACE_ICONS, PLACE_TYPES, type PlaceType } from '../types';

/** The places library: every place you've saved, reusable on any trip. */
export function PlacesLibraryPage() {
  const library = useLiveQuery(() => db.placeLibrary.orderBy('name').toArray(), []);
  const placements = useLiveQuery(() => db.places.toArray(), []);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const tripsFor = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const p of placements ?? []) {
      if (!p.libraryId) continue;
      if (!m.has(p.libraryId)) m.set(p.libraryId, new Set());
      m.get(p.libraryId)!.add(p.tripId);
    }
    return m;
  }, [placements]);

  if (!library || !placements) return null;

  const q = query.trim().toLowerCase();
  const filtered = library.filter((l) => !q || `${l.name} ${l.address} ${l.type} ${l.description}`.toLowerCase().includes(q));
  const groups = PLACE_TYPES.map((t) => ({ t, list: filtered.filter((l) => l.type === t) })).filter((g) => g.list.length);
  const other = filtered.filter((l) => !(PLACE_TYPES as readonly string[]).includes(l.type));

  return (
    <div className="page">
      <div className="page-title">
        <h1>Places</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + New place
        </button>
      </div>
      <p className="muted">
        Your places library. Add a place to any trip from a destination’s “+ Place”. Editing a place updates it on every trip
        that uses it, and removing it from a trip keeps it here.
      </p>

      {library.length === 0 ? (
        <Empty icon="📍" title="No places yet">
          <p className="muted">Places you add to trips are saved here automatically.</p>
        </Empty>
      ) : (
        <>
          <div className="filters">
            <input className="search" type="search" placeholder="Search places…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {filtered.length === 0 && <p className="muted center">No matching places.</p>}
          {[...groups, ...(other.length ? [{ t: 'Other' as PlaceType, list: other }] : [])].map(({ t, list }) => (
            <section key={t} className="section">
              <h2 className="group-title">
                <span aria-hidden>{PLACE_ICONS[t] ?? '📍'}</span> {t}
                <span className="count">{list.length}</span>
              </h2>
              <ul className="item-list">
                {list.map((l) => {
                  const n = tripsFor.get(l.id)?.size ?? 0;
                  return (
                    <li key={l.id} className="item-row">
                      <Link to={`/library/places/${l.id}`} className="item-link">
                        <Thumb photo={l.photo} icon={PLACE_ICONS[l.type] ?? '📍'} />
                        <span>
                          <span className="item-name">{l.name}</span>
                          <span className="muted small">
                            {n ? `On ${n} trip${n === 1 ? '' : 's'}` : 'Not on any trip'}
                            {l.address && ` · ${l.address}`}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}

      <PlaceDialog open={creating} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/library/places/${id}`)} />
    </div>
  );
}
