import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTripData, type TripData } from '../hooks';
import { ActivityDialog, DestinationDialog, PlaceDialog, TripDialog } from '../components/forms';
import { Breadcrumbs, Empty, Hero, NotFound, ProgressBar, SectionHeader, Thumb } from '../components/ui';
import { ActivityRow, PlaceBlock } from '../components/itinerary';
import { PackingList } from '../components/PackingList';
import { Modal } from '../components/Modal';
import { dayCount, datePart, formatDateRange, formatDayHeading, shiftYmd } from '../lib/dates';
import { deleteTrip, duplicateTrip } from '../lib/repo';
import { buildPackingList, packingProgress } from '../lib/packing';

type Tab = 'itinerary' | 'schedule' | 'packing';

type DialogState =
  | { kind: 'trip' }
  | { kind: 'destination' }
  | { kind: 'place'; destinationId: string }
  | { kind: 'activity'; placeId: string }
  | { kind: 'duplicate' }
  | null;

export function TripPage() {
  const { tripId } = useParams();
  const data = useTripData(tripId);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'itinerary';
  const [dialog, setDialog] = useState<DialogState>(null);

  if (data === undefined) return null;
  if (data === null) return <NotFound what="Trip" />;
  const { trip } = data;
  const days = dayCount(trip.startDate, trip.endDate);
  const progress = packingProgress(buildPackingList(data));

  const close = () => setDialog(null);

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: 'Trips', to: '/' }, { label: trip.name }]} />
      <Hero
        photo={trip.photo}
        icon="🧳"
        kicker="Trip"
        title={trip.name}
        subtitle={`${formatDateRange(trip.startDate, trip.endDate)} · ${days} day${days === 1 ? '' : 's'}`}
        description={trip.description}
        actions={
          <>
            <button className="btn btn-secondary btn-small" onClick={() => setDialog({ kind: 'trip' })}>
              Edit
            </button>
            <button className="btn btn-ghost btn-small" onClick={() => setDialog({ kind: 'duplicate' })}>
              Duplicate
            </button>
            <button
              className="btn btn-danger btn-small"
              onClick={async () => {
                if (confirm(`Delete “${trip.name}” and everything in it? Items stay in your library.`)) {
                  await deleteTrip(trip.id);
                  navigate('/');
                }
              }}
            >
              Delete
            </button>
          </>
        }
      />

      <div className="tabs" role="tablist">
        {(
          [
            ['itinerary', 'Itinerary'],
            ['schedule', 'Schedule'],
            ['packing', `Packing list${progress.total ? ` · ${progress.packed}/${progress.total}` : ''}`],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'active' : ''}
            onClick={() => setParams(t === 'itinerary' ? {} : { tab: t }, { replace: true })}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'itinerary' && <Itinerary data={data} setDialog={setDialog} />}
      {tab === 'schedule' && <Schedule data={data} />}
      {tab === 'packing' && <PackingList data={data} />}

      {tab !== 'packing' && progress.total > 0 && (
        <button className="packing-fab no-print" onClick={() => setParams({ tab: 'packing' }, { replace: true })}>
          <span>📋 Packing list</span>
          <span className="fab-progress">
            <ProgressBar percent={progress.percent} />
            {progress.packed}/{progress.total}
          </span>
        </button>
      )}

      <TripDialog open={dialog?.kind === 'trip'} existing={trip} onClose={close} />
      <DestinationDialog
        open={dialog?.kind === 'destination'}
        tripId={trip.id}
        onClose={close}
      />
      <PlaceDialog
        open={dialog?.kind === 'place'}
        destinationId={dialog?.kind === 'place' ? dialog.destinationId : ''}
        onClose={close}
      />
      <ActivityDialog
        open={dialog?.kind === 'activity'}
        placeId={dialog?.kind === 'activity' ? dialog.placeId : ''}
        trip={trip}
        onClose={close}
        onSaved={(id) => navigate(`/activities/${id}`)}
      />
      <DuplicateDialog open={dialog?.kind === 'duplicate'} data={data} onClose={close} />
    </div>
  );
}

function Itinerary({ data, setDialog }: { data: TripData; setDialog: (d: DialogState) => void }) {
  const { destinations, places, activities, activityItems, items } = data;
  if (!destinations.length) {
    return (
      <Empty icon="🗺️" title="Where are you going?">
        <p className="muted">Add a destination like Las Vegas or New York, then the places you’ll visit there.</p>
        <button className="btn btn-primary" onClick={() => setDialog({ kind: 'destination' })}>
          + Add destination
        </button>
      </Empty>
    );
  }
  return (
    <div className="itinerary">
      {destinations.map((d) => {
        const dPlaces = places.filter((p) => p.destinationId === d.id);
        return (
          <section key={d.id} className="dest-block">
            <div className="dest-head">
              <Link to={`/destinations/${d.id}`} className="dest-link">
                <Thumb photo={d.photo} icon="📍" />
                <span>
                  <span className="kicker">Destination</span>
                  <span className="dest-name">{d.name}</span>
                </span>
              </Link>
              <button className="btn btn-small btn-secondary" onClick={() => setDialog({ kind: 'place', destinationId: d.id })}>
                + Place
              </button>
            </div>
            {dPlaces.length === 0 ? (
              <p className="muted small indent">No places yet — add a hotel, restaurant or venue.</p>
            ) : (
              dPlaces.map((p) => (
                <PlaceBlock
                  key={p.id}
                  place={p}
                  activities={activities.filter((a) => a.placeId === p.id)}
                  activityItems={activityItems}
                  items={items}
                  onAddActivity={() => setDialog({ kind: 'activity', placeId: p.id })}
                />
              ))
            )}
          </section>
        );
      })}
      <button className="btn btn-secondary add-block" onClick={() => setDialog({ kind: 'destination' })}>
        + Add destination
      </button>
    </div>
  );
}

function Schedule({ data }: { data: TripData }) {
  const { trip, activities, places, destinations, activityItems, items } = data;
  const placeById = new Map(places.map((p) => [p.id, p]));
  const destById = new Map(destinations.map((d) => [d.id, d]));
  const days: string[] = [];
  for (let i = 0; i < dayCount(trip.startDate, trip.endDate); i++) days.push(shiftYmd(trip.startDate, i));

  return (
    <div className="schedule">
      {days.map((day, i) => {
        const dayActs = activities.filter((a) => datePart(a.start) === day);
        return (
          <section key={day} className="day-block">
            <SectionHeader title={`Day ${i + 1} · ${formatDayHeading(day)}`} />
            {dayActs.length === 0 ? (
              <p className="muted small indent">Nothing planned.</p>
            ) : (
              <ul className="activity-list">
                {dayActs.map((a) => (
                  <li key={a.id}>
                    <ActivityRow
                      activity={a}
                      activityItems={activityItems}
                      items={items}
                      context={`${placeById.get(a.placeId)?.name ?? ''}, ${destById.get(a.destinationId)?.name ?? ''}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function DuplicateDialog({ open, data, onClose }: { open: boolean; data: TripData; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} title="Duplicate trip" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const t = await duplicateTrip(data.trip.id, name || `${data.trip.name} (copy)`, start || data.trip.startDate);
            onClose();
            navigate(`/trips/${t.id}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted">
          Copies every destination, place, activity and item. Activity times shift with the new start date. Packed
          checkmarks start fresh.
        </p>
        <div className="field">
          <label className="label" htmlFor="dup-name">
            New trip name
          </label>
          <input id="dup-name" value={name} placeholder={`${data.trip.name} (copy)`} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="dup-start">
            New start date
          </label>
          <input id="dup-start" type="date" value={start || data.trip.startDate} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Duplicate
          </button>
        </div>
      </form>
    </Modal>
  );
}
