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
import { setAllPacked, setPacked } from '../lib/repo';
import { formatActivityTime } from '../lib/dates';
import { CATEGORY_ICONS } from '../types';
import { Empty, ProgressBar, Thumb } from './ui';

const GROUP_KEY = 'packlist.groupBy';
const HIDE_KEY = 'packlist.hidePacked';

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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const entries = useMemo(() => buildPackingList(data), [data]);
  const groups = useMemo(() => groupPackingList(entries, groupBy, data.destinations), [entries, groupBy, data.destinations]);
  const progress = packingProgress(entries);

  if (!entries.length) {
    return (
      <Empty icon="📋" title="Your packing list is empty">
        <p className="muted">Add items to your activities and they’ll show up here, organized and ready to check off.</p>
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
          {(['category', 'day', 'destination'] as GroupBy[]).map((g) => (
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
              {g === 'category' ? 'Category' : g === 'day' ? 'Day' : 'Destination'}
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
        <div className="toolbar-actions">
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
                    showCategory={groupBy !== 'category'}
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
  showCategory,
  expanded,
  onToggleExpand,
}: {
  entry: PackingEntry;
  tripId: string;
  showCategory: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const { item, quantity, usages, packed } = entry;
  const uses = [...new Set(usages.map((u) => u.activity.name))];
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
            {quantity > 1 && <span className="qty">×{quantity}</span>}
          </span>
          <span className="muted small">
            {showCategory && `${item.category} · `}
            {uses.join(', ')}
          </span>
        </button>
      </div>
      {expanded && (
        <div className="packing-detail">
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
