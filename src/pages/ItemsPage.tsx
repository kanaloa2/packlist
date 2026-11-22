import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useAllItems } from '../hooks';
import { ItemDialog } from '../components/forms';
import { Empty, Thumb } from '../components/ui';
import { CATEGORY_ICONS, ITEM_CATEGORIES, type ItemCategory } from '../types';

export function ItemsPage() {
  const items = useAllItems();
  const links = useLiveQuery(() => db.activityItems.toArray(), []);
  const tripLinks = useLiveQuery(() => db.tripItems.toArray(), []);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ItemCategory | 'All'>('All');
  const [creating, setCreating] = useState(false);

  const usage = useMemo(() => {
    const m = new Map<string, { activities: number; trips: Set<string> }>();
    for (const l of links ?? []) {
      const u = m.get(l.itemId) ?? { activities: 0, trips: new Set() };
      u.activities++;
      u.trips.add(l.tripId);
      m.set(l.itemId, u);
    }
    for (const l of tripLinks ?? []) {
      const u = m.get(l.itemId) ?? { activities: 0, trips: new Set() };
      u.trips.add(l.tripId);
      m.set(l.itemId, u);
    }
    return m;
  }, [links, tripLinks]);

  if (!items || !links) return null;

  const q = query.trim().toLowerCase();
  const filtered = items.filter(
    (i) => (category === 'All' || i.category === category) && (!q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q) || (i.kind ?? '').toLowerCase().includes(q)),
  );
  const groups = ITEM_CATEGORIES.map((c) => ({ c, list: filtered.filter((i) => i.category === c) })).filter((g) => g.list.length);

  return (
    <div className="page">
      <div className="page-title">
        <h1>Items</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + New item
        </button>
      </div>
      <p className="muted">
        Your item library. Every item can be selected on any activity of any trip — create it once, reuse it forever.
      </p>

      {items.length === 0 ? (
        <Empty icon="👕" title="No items yet">
          <p className="muted">Add clothes, toiletries, gadgets and documents here, or create them right from an activity.</p>
        </Empty>
      ) : (
        <>
          <div className="filters">
            <input className="search" type="search" placeholder="Search items…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select value={category} onChange={(e) => setCategory(e.target.value as ItemCategory | 'All')} aria-label="Category">
              <option value="All">All categories</option>
              {ITEM_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          {groups.length === 0 && <p className="muted center">No matching items.</p>}
          {groups.map(({ c, list }) => (
            <section key={c} className="section">
              <h2 className="group-title">
                <span aria-hidden>{CATEGORY_ICONS[c]}</span> {c}
                <span className="count">{list.length}</span>
              </h2>
              <ul className="item-list">
                {list.map((i) => {
                  const u = usage.get(i.id);
                  return (
                    <li key={i.id} className="item-row">
                      <Link to={`/items/${i.id}`} className="item-link">
                        <Thumb photo={i.photo} icon={CATEGORY_ICONS[i.category]} />
                        <span>
                          <span className="item-name">{i.name}</span>
                          <span className="muted small">
                            {i.kind && `${i.kind} · `}
                            {u
                              ? [u.activities && `${u.activities} activit${u.activities === 1 ? 'y' : 'ies'}`, `${u.trips.size} trip${u.trips.size === 1 ? '' : 's'}`].filter(Boolean).join(' · ')
                              : 'Not used yet'}
                            {i.description && ` · ${i.description}`}
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

      <ItemDialog
        open={creating}
        defaultCategory={category === 'All' ? 'Clothing' : category}
        onClose={() => setCreating(false)}
        onSaved={(id) => navigate(`/items/${id}`)}
      />
    </div>
  );
}
