import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { ItemDialog } from './forms';
import { Thumb } from './ui';
import { CATEGORY_ICONS, ITEM_CATEGORIES, type Item, type ItemCategory } from '../types';

/**
 * Pick items from the library (search, filter by category) or create new ones on the spot.
 * Used for an activity's items and for whole-trip items.
 */
export function ItemPicker({
  open,
  onClose,
  title = 'Add items',
  allItems,
  selected,
  onAdd,
  onRemove,
  tripItemIds,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  allItems: Item[];
  /** Items already added here (shown ticked; tapping removes). */
  selected: Set<string>;
  onAdd: (itemId: string) => Promise<unknown>;
  onRemove: (itemId: string) => Promise<unknown>;
  /** Items used anywhere on this trip; they're listed first. */
  tripItemIds: Set<string>;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ItemCategory | 'All'>('All');
  const [creating, setCreating] = useState(false);
  const [justAdded, setJustAdded] = useState<string[]>([]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    const list = allItems.filter(
      (i) =>
        (category === 'All' || i.category === category) &&
        (!q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)),
    );
    // Items already used elsewhere on this trip float to the top — you're likely to reuse them.
    return list.sort((a, b) => Number(tripItemIds.has(b.id)) - Number(tripItemIds.has(a.id)) || a.name.localeCompare(b.name));
  }, [allItems, category, q, tripItemIds]);
  const exact = allItems.some((i) => i.name.toLowerCase() === q);

  async function toggle(item: Item) {
    if (selected.has(item.id)) {
      await onRemove(item.id);
      setJustAdded((x) => x.filter((id) => id !== item.id));
    } else {
      await onAdd(item.id);
      setJustAdded((x) => [...x, item.id]);
    }
  }

  function close() {
    setQuery('');
    setJustAdded([]);
    onClose();
  }

  return (
    <>
      <Modal open={open && !creating} title={title} onClose={close} wide>
        <div className="picker">
          <input
            className="search"
            type="search"
            placeholder="Search your items or type a new one…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && q && !exact) {
                // Consume the key so it can't also submit the "New item" form that opens.
                e.preventDefault();
                setCreating(true);
              }
            }}
          />
          <div className="chips" role="radiogroup" aria-label="Category">
            {(['All', ...ITEM_CATEGORIES] as const).map((c) => (
              <button key={c} role="radio" aria-checked={category === c} className={`chip${category === c ? ' active' : ''}`} onClick={() => setCategory(c)}>
                {c !== 'All' && <span aria-hidden>{CATEGORY_ICONS[c]} </span>}
                {c}
              </button>
            ))}
          </div>

          <button className="btn btn-secondary create-new" onClick={() => setCreating(true)}>
            + Create {q && !exact ? `“${query.trim()}”` : 'a new item'}
          </button>

          {results.length === 0 ? (
            <p className="muted center">{allItems.length ? 'No matching items.' : 'Your item library is empty — create your first item above.'}</p>
          ) : (
            <ul className="picker-list">
              {results.map((i) => {
                const added = selected.has(i.id);
                return (
                  <li key={i.id}>
                    <button className={`picker-item${added ? ' added' : ''}`} onClick={() => toggle(i)} aria-pressed={added}>
                      <Thumb photo={i.photo} icon={CATEGORY_ICONS[i.category]} size="sm" />
                      <span className="picker-text">
                        <span>{i.name}</span>
                        <span className="muted small">
                          {i.category}
                          {tripItemIds.has(i.id) && ' · on this trip'}
                        </span>
                      </span>
                      <span className="picker-check" aria-hidden>
                        {added ? '✓' : '+'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="form-actions">
            <span className="muted small">{justAdded.length ? `${justAdded.length} added` : ''}</span>
            <button className="btn btn-primary" onClick={close}>
              Done
            </button>
          </div>
        </div>
      </Modal>
      <ItemDialog
        open={open && creating}
        defaultName={query.trim()}
        defaultCategory={category === 'All' ? 'Clothing' : category}
        onClose={() => setCreating(false)}
        onSaved={async (id) => {
          await onAdd(id);
          setJustAdded((x) => [...x, id]);
          setQuery('');
        }}
      />
    </>
  );
}
