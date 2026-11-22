import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Modal } from './Modal';
import { Thumb } from './ui';
import { copyItemLinks } from '../lib/repo';
import { formatChipTime, formatDateRange } from '../lib/dates';
import { CATEGORY_ICONS, type Activity, type Item, type Trip } from '../types';

type Direction = 'in' | 'out';
type Link = { itemId: string; quantity: number; note: string };
/** The other end of the copy: an activity id, or "whole" for the trip's whole-trip items. */
const WHOLE = 'whole';

/**
 * Copy items between this activity and any activity (or whole-trip list) on any trip, in
 * either direction, choosing exactly which items to copy.
 */
export function CopyItemsDialog({ open, onClose, activity, trip }: { open: boolean; onClose: () => void; activity: Activity; trip: Trip }) {
  const [direction, setDirection] = useState<Direction>('in');
  const [tripId, setTripId] = useState(trip.id);
  const [other, setOther] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const trips = useLiveQuery(() => db.trips.toArray(), []) ?? [];
  const items = useLiveQuery(() => db.items.toArray(), []) ?? [];
  const here = useLiveQuery(() => db.activityItems.where('activityId').equals(activity.id).toArray(), [activity.id]) ?? [];
  const tripData = useLiveQuery(async () => {
    const [activities, places, activityItems, tripItems] = await Promise.all([
      db.activities.where('tripId').equals(tripId).sortBy('start'),
      db.places.where('tripId').equals(tripId).toArray(),
      db.activityItems.where('tripId').equals(tripId).toArray(),
      db.tripItems.where('tripId').equals(tripId).toArray(),
    ]);
    return { activities, places, activityItems, tripItems };
  }, [tripId]);

  // Reset to this trip each time the dialog opens.
  useEffect(() => {
    if (open) {
      setTripId(trip.id);
      setOther('');
      setMessage('');
    }
  }, [open, trip.id]);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const placeName = (id: string) => tripData?.places.find((p) => p.id === id)?.name ?? '';
  const otherActivities = (tripData?.activities ?? []).filter((a) => a.id !== activity.id);
  const linksOf = (key: string): Link[] =>
    key === WHOLE ? (tripData?.tripItems ?? []) : key ? (tripData?.activityItems ?? []).filter((l) => l.activityId === key) : [];

  const source = direction === 'in' ? linksOf(other) : here;
  const targetLinks = direction === 'in' ? here : linksOf(other);
  const already = new Set(targetLinks.map((l) => l.itemId));
  const rows = source
    .map((l) => ({ link: l, item: itemById.get(l.itemId) }))
    .filter((r): r is { link: Link & { itemId: string }; item: Item } => !!r.item)
    .sort((a, b) => a.item.name.localeCompare(b.item.name));
  const copyable = rows.filter((r) => !already.has(r.item.id));

  // Tick everything copyable whenever the source or target changes.
  const selectionKey = `${direction}|${tripId}|${other}|${source.length}|${targetLinks.length}`;
  useEffect(() => {
    setSelected(new Set(copyable.map((r) => r.item.id)));
  }, [selectionKey]);

  const otherLabel = (key: string) => {
    if (key === WHOLE) return `the whole trip${tripId === trip.id ? '' : ` (${trips.find((t) => t.id === tripId)?.name ?? ''})`}`;
    const a = otherActivities.find((x) => x.id === key);
    if (!a) return '';
    return `${a.name}${tripId === trip.id ? '' : ` (${trips.find((t) => t.id === tripId)?.name ?? ''})`}`;
  };

  async function copy() {
    if (!other || !selected.size) return;
    setBusy(true);
    try {
      const picked = rows.filter((r) => selected.has(r.item.id)).map((r) => r.link);
      const target = direction === 'in' ? { kind: 'activity' as const, id: activity.id } : other === WHOLE ? { kind: 'trip' as const, id: tripId } : { kind: 'activity' as const, id: other };
      const n = await copyItemLinks(picked, target);
      const what = `${n} item${n === 1 ? '' : 's'}`;
      setMessage(direction === 'in' ? `Added ${what} from ${otherLabel(other)}.` : `Copied ${what} to ${otherLabel(other)}.`);
    } finally {
      setBusy(false);
    }
  }

  const sortedTrips = [...trips].sort((a, b) => (a.id === trip.id ? -1 : b.id === trip.id ? 1 : b.startDate.localeCompare(a.startDate)));
  const countOn = (key: string) => linksOf(key).length;

  return (
    <Modal open={open} title="Copy items" onClose={onClose} wide>
      <div className="form copy-dialog">
        <div className="segmented" role="radiogroup" aria-label="Direction">
          {(
            [
              ['in', 'Bring items here'],
              ['out', 'Send items from here'],
            ] as [Direction, string][]
          ).map(([d, label]) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={direction === d}
              className={direction === d ? 'active' : ''}
              onClick={() => {
                setDirection(d);
                setMessage('');
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="field">
          <label className="label" htmlFor="copy-trip">
            {direction === 'in' ? 'From trip' : 'To trip'}
          </label>
          <select
            id="copy-trip"
            value={tripId}
            onChange={(e) => {
              setTripId(e.target.value);
              setOther('');
              setMessage('');
            }}
          >
            {sortedTrips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.id === trip.id ? ' (this trip)' : ` · ${formatDateRange(t.startDate, t.endDate)}`}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label" htmlFor="copy-other">
            {direction === 'in' ? 'From' : 'To'}
          </label>
          <select
            id="copy-other"
            value={other}
            onChange={(e) => {
              setOther(e.target.value);
              setMessage('');
            }}
          >
            <option value="">{direction === 'in' ? 'Choose where to copy from…' : 'Choose where to copy to…'}</option>
            <option value={WHOLE} disabled={direction === 'in' && countOn(WHOLE) === 0}>
              Whole trip items{direction === 'in' ? ` (${countOn(WHOLE)})` : ''}
            </option>
            {otherActivities.map((a: Activity) => (
              <option key={a.id} value={a.id} disabled={direction === 'in' && countOn(a.id) === 0}>
                {a.name} · {formatChipTime(a.start)}
                {placeName(a.placeId) ? ` · ${placeName(a.placeId)}` : ''}
                {direction === 'in' ? ` (${countOn(a.id)})` : ''}
              </option>
            ))}
          </select>
          {otherActivities.length === 0 && <p className="hint">This trip has no other activities.</p>}
        </div>

        {(direction === 'out' || other) && (
          <div className="field">
            <div className="copy-items-head">
              <span className="label">{direction === 'in' ? 'Items to bring here' : 'Items to send'}</span>
              {copyable.length > 0 && (
                <span className="row-actions">
                  <button type="button" className="link-btn small" onClick={() => setSelected(new Set(copyable.map((r) => r.item.id)))}>
                    All
                  </button>
                  <button type="button" className="link-btn small" onClick={() => setSelected(new Set())}>
                    None
                  </button>
                </span>
              )}
            </div>
            {rows.length === 0 ? (
              <p className="muted small">{direction === 'in' ? 'No items there.' : 'This activity has no items yet.'}</p>
            ) : (
              <ul className="copy-items">
                {rows.map(({ link, item }) => {
                  const isThere = already.has(item.id) && !!other;
                  return (
                    <li key={item.id}>
                      <label className={`toggle copy-item${isThere ? ' copy-item-there' : ''}`}>
                        <input
                          type="checkbox"
                          disabled={isThere}
                          checked={!isThere && selected.has(item.id)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(item.id);
                            else next.delete(item.id);
                            setSelected(next);
                          }}
                        />
                        <Thumb photo={item.photo} icon={CATEGORY_ICONS[item.category]} size="sm" />
                        <span className="copy-item-text">
                          <span>
                            {item.name}
                            {link.quantity > 1 && <span className="qty">×{link.quantity}</span>}
                          </span>
                          <span className="muted small">{isThere ? 'Already there' : item.kind || item.category}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {message && (
          <p className="success" role="status">
            {message}
          </p>
        )}

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Done
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !other || selected.size === 0} onClick={copy}>
            {selected.size ? `Copy ${selected.size} item${selected.size === 1 ? '' : 's'}` : 'Copy'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
