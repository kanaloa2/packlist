# Packlist

Packlist keeps track of what to pack for your trips. You plan the trip and Packlist builds the packing list as you go.

**Use it:** https://kanaloa2.github.io/packlist/ (works on phone and desktop; add it to your home screen to use it like an app, offline included)

## How it's organized

```
Trip (start & end dates)
└── Destination (Las Vegas, New York…)
    └── Place (hotel, restaurant, pool…)
        └── Activity (check in, dinner, pool time…; start/end must fall within the trip)
            └── Items (what to wear or bring)
```

- **Every object** (trip, destination, place, activity, item) can have a **photo** and a **description**.
- **Items** live in a shared library. On any activity you can **select** an existing item or **create** a new one on the spot. Items already used on the current trip are listed first.
- **The packing list** for a trip collects every item from every activity:
  - Group it by **category**, by the **day** an item is first needed, or by **destination**.
  - Check items off as you pack, hide packed items, mark everything packed at once, share or copy the list as text, or print it.
  - Tap an item to see which activities need it.
  - Items are things you own, so reusing your black jeans on three activities still means packing one pair. The list uses the largest quantity any single activity needs.
- **Schedule** view shows the trip day by day.
- **Duplicate** a trip to reuse its whole itinerary on new dates. **Copy items** from one activity to another.
- Activity times are validated against the trip's dates. A trip's dates can't be changed in a way that would leave activities outside the trip.

## Your data

Everything, photos included, is stored on your device in the browser (IndexedDB). Nothing is uploaded. Photos are resized before saving. Use **Settings → Export backup** to save a JSON backup or move your data to another device, and **Import backup** to restore it.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest + fake-indexeddb)
npm run build      # type-check + production build to dist/
```

Built with React, TypeScript, Vite, Dexie (IndexedDB) and vite-plugin-pwa. Every push to `main` is tested and deployed to GitHub Pages by `.github/workflows/deploy.yml`.

### Code map

| Path | What it does |
| --- | --- |
| `src/types.ts` | Data model: Trip, Destination, Place, Activity, Item, ActivityItem, PackStatus |
| `src/db.ts` | IndexedDB schema |
| `src/lib/repo.ts` | Create/update/delete with validation, cascading deletes, duplicate and copy |
| `src/lib/packing.ts` | Packing list aggregation, grouping and text export |
| `src/lib/dates.ts` | Date formatting and trip/activity date validation |
| `src/lib/backup.ts` | JSON export/import |
| `src/pages/*` | Screens: trips, trip, destination, place, activity, items, item, settings |
