import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TripData } from '../hooks';
import {
  buildPackingList,
  groupPackingList,
  packingListToText,
  packingProgress,
  type GroupBy,
  type PackingEntry,
} from '../lib/packing';
import { addItemToTrip, removeItemFromTrip, setAllPacked, setPackQuantity, setPacked } from '../lib/repo';
import { useAllItems } from '../hooks';
import { ItemPicker } from './ItemPicker';
import { formatActivityTime, formatChipTime } from '../lib/dates';
import { CATEGORY_ICONS } from '../types';
import { typeLabel } from '../lib/itemTypes';
import { Empty, ProgressBar, Thumb } from './ui';

const GROUP_KEY = 'packlist.groupBy';
const HIDE_KEY = 'packlist.hidePacked';
const ACTS_KEY = 'packlist.showActivities';
const GROUP_LABELS: Record<GroupBy, string> = { category: 'Category', type: 'Type', day: 'Day', destination: 'Destination' };

function readPref(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function PackingList({ data }: { data: TripData }) {
  const [groupBy, setGroupBy] = useState<GroupBy>(() => readPref(GROUP_KEY, 'category') as GroupBy);
  const [hidePacked, setHidePacked] = useState(() => readPref(HIDE_KEY, '0') === '1');
  const [showActivities, setShowActivities] = useState(() => readPref(ACTS_KEY, '1') === '1');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);
  const allItems = useAllItems();

  const entries = useMemo(() => buildPackingList(data), [data]);
  const groups = useMemo(() => groupPackingList(entries, groupBy, data.destinations), [entries, groupBy, data.destinations]);
  const progress = packingProgress(entries);

  const picker = (
    <ItemPicker
      open={picking}
      onClose={() => setPicking(false)}
      title="Add items to the whole trip"
      allItems={allItems ?? []}
      selected={new Set(data.tripItems.map((l) => l.itemId))}
      onAdd={(itemId) => addItemToTrip(data.trip.id, itemId)}
      onRemove={(itemId) => removeItemFromTrip(data.trip.id, itemId)}
      tripItemIds={new Set([...data.activityItems, ...data.tripItems].map((l) => l.itemId))}
    />
  );

  if (!entries.length) {
    return (
      <Empty icon="📋" title="Your packing list is empty">
        <p className="muted">
          Add items to your activities and they’ll show up here, organized and ready to check off. Things you need for the
          whole trip, like a passport or chargers, can be added directly.
        </p>
        <button className="btn btn-primary" onClick={() => setPicking(true)}>
          + Add items to the whole trip
        </button>
        {picker}
      </Empty>
    );
  }

  const allPacked = progress.packed === progress.total;

  async function copy() {
    const text = packingListToText(data.trip.name, groups);
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: `${data.trip.name} packing list`, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* user cancelled share, or clipboard blocked */
    }
  }

  return (
    <div className="packing">
      <div className="packing-summary">
        <div className="packing-count">
          <strong>
            {progress.packed} of {progress.total}
          </strong>{' '}
          items packed
          {allPacked && <span className="done-badge">All packed! 🎉</span>}
        </div>
        <ProgressBar percent={progress.percent} label="Packing progress" />
      </div>

      <div className="packing-toolbar no-print">
        <div className="segmented" role="radiogroup" aria-label="Group by">
          {(['category', 'type', 'day', 'destination'] as GroupBy[]).map((g) => (
            <button
              key={g}
              role="radio"
              aria-checked={groupBy === g}
              className={groupBy === g ? 'active' : ''}
              onClick={() => {
                setGroupBy(g);
                writePref(GROUP_KEY, g);
              }}
            >
              {GROUP_LABELS[g]}
            </button>
          ))}
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={hidePacked}
            onChange={(e) => {
              setHidePacked(e.target.checked);
              writePref(HIDE_KEY, e.target.checked ? '1' : '0');
            }}
          />
          Hide packed
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showActivities}
            onChange={(e) => {
              setShowActivities(e.target.checked);
              writePref(ACTS_KEY, e.target.checked ? '1' : '0');
            }}
          />
          Show activities
        </label>
        <div className="toolbar-actions">
          <button className="btn btn-small btn-secondary" onClick={() => setPicking(true)} title="Add items you need for the whole trip, not one activity">
            + Whole trip
          </button>
          <button className="btn btn-small btn-ghost" onClick={copy}>
            {copied ? 'Copied ✓' : 'Share / copy'}
          </button>
          <button className="btn btn-small btn-ghost" onClick={() => window.print()}>
            Print
          </button>
          <button
            className="btn btn-small btn-ghost"
            onClick={() => setAllPacked(data.trip.id, entries.map((e) => e.item.id), !allPacked)}
          >
            {allPacked ? 'Unpack all' : 'Pack all'}
          </button>
        </div>
      </div>

      <h2 className="print-only">{data.trip.name} — Packing List</h2>
      {picker}

      {groups.map((g) => {
        const visible = hidePacked ? g.entries.filter((e) => !e.packed) : g.entries;
        const done = g.entries.filter((e) => e.packed).length;
        return (
          <section key={g.key} className="packing-group">
            <h3 className="packing-group-title">
              {groupBy === 'category' && <span aria-hidden>{CATEGORY_ICONS[g.key as keyof typeof CATEGORY_ICONS]} </span>}
              {g.label}
              <span className="count">
                {done}/{g.entries.length}
              </span>
            </h3>
            {visible.length === 0 ? (
              <p className="muted small group-done">Everything here is packed.</p>
            ) : (
              <ul className="packing-items">
                {visible.map((e) => (
                  <PackingRow
                    key={e.item.id}
                    entry={e}
                    tripId={data.trip.id}
                    groupBy={groupBy}
                    showActivities={showActivities}
                    expanded={expanded === `${g.key}:${e.item.id}`}
                    onToggleExpand={() => setExpanded((x) => (x === `${g.key}:${e.item.id}` ? null : `${g.key}:${e.item.id}`))}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function PackingRow({
  entry,
  tripId,
  groupBy,
  showActivities,
  expanded,
  onToggleExpand,
}: {
  entry: PackingEntry;
  tripId: string;
  groupBy: GroupBy;
  showActivities: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const { item, quantity, autoQuantity, manual, reason, usages, packed, tripLevel } = entry;
  // What kind of thing this is, unless the group heading already says so.
  const kindText = groupBy === 'type' ? (item.kind ? item.category : '') : groupBy === 'category' ? item.kind ?? '' : typeLabel(item);
  const summary = [tripLevel && 'Whole trip', usages.length && `${usages.length} activit${usages.length === 1 ? 'y' : 'ies'}`]
    .filter(Boolean)
    .join(' + ');
  return (
    <li className={`packing-item${packed ? ' packed' : ''}`}>
      <div className="packing-row">
        <label className="check">
          <input type="checkbox" checked={packed} onChange={(e) => setPacked(tripId, item.id, e.target.checked)} />
          <span className="checkmark" aria-hidden />
          <span className="sr-only">Packed {item.name}</span>
        </label>
        <Thumb photo={item.photo} icon={CATEGORY_ICONS[item.category]} size="sm" />
        <button className="packing-info" onClick={onToggleExpand} aria-expanded={expanded}>
          <span className="packing-name">
            {item.name}
            {(quantity > 1 || manual) && (
              <span className={`qty${manual ? ' qty-manual' : ''}`} title={manual ? 'Count set by you for this trip' : reason}>
                ×{quantity}
              </span>
            )}
          </span>
          <span className="muted small">
            {[kindText, showActivities ? '' : summary].filter(Boolean).join(' · ')}
          </span>
        </button>
      </div>
      {showActivities && (
        <ul className="usage-chips" aria-label={`Activities using ${item.name}`}>
          {tripLevel && (
            <li>
              <span className="usage-chip usage-chip-trip" title="Added to the whole trip, not one activity">
                Whole trip
              </span>
            </li>
          )}
          {usages.map((u, i) => (
            <li key={i}>
              <Link
                to={`/activities/${u.activity.id}`}
                className="usage-chip"
                title={`${u.activity.name} · ${u.place?.name ?? ''} · ${formatActivityTime(u.activity.start, u.activity.end)}`}
              >
                {u.activity.name}
                <span className="usage-when">{formatChipTime(u.activity.start)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {expanded && (
        <div className="packing-detail">
          <div className="count-control">
            <span className="label small">Pack for this trip</span>
            <div className="stepper" aria-label={`How many ${item.name} to pack`}>
              <button
                aria-label="Pack fewer"
                disabled={quantity <= 1}
                onClick={() => setCount(tripId, item.id, quantity - 1, autoQuantity)}
              >
                −
              </button>
              <span>{quantity}</span>
              <button aria-label="Pack more" onClick={() => setCount(tripId, item.id, quantity + 1, autoQuantity)}>
                +
              </button>
            </div>
            <span className="muted small count-reason">
              {manual ? (
                <>
                  Set by you for this trip.{' '}
                  <button className="link-btn" onClick={() => setPackQuantity(tripId, item.id, null)}>
                    Use automatic ({autoQuantity})
                  </button>
                </>
              ) : (
                `Automatic: ${reason}`
              )}
            </span>
          </div>
          {tripLevel && (
            <p className="small trip-level-note">
              On the whole trip{tripLevel.note && ` · ${tripLevel.note}`}.{' '}
              <button className="link-btn" onClick={() => removeItemFromTrip(tripId, item.id)}>
                Remove from whole trip
              </button>
            </p>
          )}
          {item.description && <p className="description">{item.description}</p>}
          <ul className="usage-list">
            {usages.map((u, i) => (
              <li key={i}>
                <Link to={`/activities/${u.activity.id}`}>{u.activity.name}</Link>
                <span className="muted small">
                  {' '}
                  · {u.place?.name} · {u.destination?.name} · {formatActivityTime(u.activity.start, u.activity.end)}
                  {u.quantity > 1 && ` · ×${u.quantity}`}
                  {u.note && ` · ${u.note}`}
                </span>
              </li>
            ))}
          </ul>
          <Link to={`/items/${item.id}`} className="small">
            View item →
          </Link>
        </div>
      )}
    </li>
  );
}

/** Stepping back to the automatic count clears the manual one, so it keeps following the trip. */
function setCount(tripId: string, itemId: string, next: number, auto: number) {
  return setPackQuantity(tripId, itemId, next === auto ? null : next);
}
