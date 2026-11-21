import { Link } from 'react-router-dom';
import type { Activity, ActivityItem, Item, Place } from '../types';
import { PLACE_ICONS } from '../types';
import { formatActivityTime } from '../lib/dates';
import { Thumb } from './ui';

interface PlaceBlockProps {
  place: Place;
  activities: Activity[];
  activityItems: ActivityItem[];
  items: Item[];
  onAddActivity: () => void;
}

/** A place with its activities listed underneath (used on Trip and Destination pages). */
export function PlaceBlock({ place, activities, activityItems, items, onAddActivity }: PlaceBlockProps) {
  return (
    <div className="place-block">
      <div className="place-head">
        <Link to={`/places/${place.id}`} className="place-link">
          <Thumb photo={place.photo} icon={PLACE_ICONS[place.type] ?? '📍'} size="sm" />
          <span>
            <span className="place-name">{place.name}</span>
            <span className="muted small">{place.type}</span>
          </span>
        </Link>
        <button className="btn btn-small btn-ghost" onClick={onAddActivity}>
          + Activity
        </button>
      </div>
      {activities.length > 0 && (
        <ul className="activity-list">
          {activities.map((a) => (
            <li key={a.id}>
              <ActivityRow activity={a} activityItems={activityItems} items={items} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ActivityRow({
  activity,
  activityItems,
  items,
  context,
}: {
  activity: Activity;
  activityItems: ActivityItem[];
  items: Item[];
  context?: string;
}) {
  const links = activityItems.filter((l) => l.activityId === activity.id);
  const byId = new Map(items.map((i) => [i.id, i]));
  const linked = links.map((l) => byId.get(l.itemId)).filter((i): i is Item => !!i);
  return (
    <Link to={`/activities/${activity.id}`} className="activity-row">
      <span className="activity-main">
        <span className="activity-name">{activity.name}</span>
        <span className="muted small">
          {formatActivityTime(activity.start, activity.end)}
          {context ? ` · ${context}` : ''}
        </span>
      </span>
      <span className={`pill${linked.length ? '' : ' pill-warn'}`} title={linked.map((i) => i.name).join(', ')}>
        {linked.length ? `${linked.length} item${linked.length === 1 ? '' : 's'}` : 'No items'}
      </span>
    </Link>
  );
}
