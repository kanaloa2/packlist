# Packlist

Packlist keeps track of what to pack for your trips. You plan the trip and Packlist builds the packing list as you go.

**Use it:** https://kanaloa2.github.io/packlist/. Create an account with your email and a password, then sign in on any device. It works on phone and desktop, and you can add it to your home screen to use it like an app, offline included.

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

## Accounts, sync and privacy

- **Sign in anywhere.** Your trips, items and photos are saved to your account in Supabase (Postgres), so they're on every device you sign in on. Accounts use email and password, with a "Forgot password?" reset by email.
- **Only you can see your data.** Every table has row-level security: each row belongs to one user, and the database only lets that user read or change it. Signed-out visitors get nothing. Child rows (a place in a destination, an item on an activity) can only point to parents owned by the same user, which composite foreign keys enforce in the database itself. Photos live in a private storage bucket where each user can only reach their own folder.
- **Works offline.** Each device keeps a local copy (IndexedDB). You can view trips and tick off packed items with no signal. Changes are queued and sync when you're back online. The status pill in the top bar shows Synced, Syncing…, Offline or pending changes; tap it to sync now.
- **Live across devices.** A change on one device shows up on your other signed-in devices within a second or two.
- **Signing out** removes the local copy from that device. Your data stays in your account.
- **Upgrading from the no-account version:** the first time you sign in on a device that already has trips, Packlist asks whether to add them to your account.
- **Backups:** **Settings → Export backup** still saves everything as a JSON file, and **Import backup** restores it into your account.

If the same thing is edited on two devices while one of them is offline, the last change to reach the server wins.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest + fake-indexeddb + an in-memory fake Supabase)
npm run build      # type-check + production build to dist/
```

Built with React, TypeScript, Vite, Dexie (IndexedDB), Supabase (Postgres, Auth, Storage, Realtime) and vite-plugin-pwa. Every push to `main` is tested and deployed to GitHub Pages by `.github/workflows/deploy.yml`.

The Supabase project URL and publishable key are in `src/supabase.ts`. They're public by design, because row-level security is what protects the data. To point a build at a different project, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The database schema is in `supabase/migrations/`.

**Supabase settings** (dashboard → Authentication → URL Configuration): set **Site URL** to `https://kanaloa2.github.io/packlist/` so confirmation and password-reset emails link back to the app. Supabase's built-in email service only sends a few emails per hour and only to members of your Supabase organization. To let other people sign up, configure custom SMTP (Authentication → Emails → SMTP Settings).

### Code map

| Path | What it does |
| --- | --- |
| `src/types.ts` | Data model: Trip, Destination, Place, Activity, Item, ActivityItem, PackStatus |
| `src/db.ts` | IndexedDB schema |
| `src/lib/repo.ts` | Create/update/delete with validation, cascading deletes, duplicate and copy |
| `src/lib/packing.ts` | Packing list aggregation, grouping and text export |
| `src/lib/dates.ts` | Date formatting and trip/activity date validation |
| `src/lib/backup.ts` | JSON export/import |
| `src/supabase.ts` | Supabase client (PKCE auth flow, which works with the app's `#/` routes) |
| `src/auth/` | Sign-in, sign-up, password reset, and the gate that ties the local copy to the signed-in user |
| `src/sync/engine.ts` | Offline-first sync: change queue, push, pull, photo upload/download, live updates |
| `src/sync/mapping.ts` | Local ⇄ Postgres field mapping |
| `supabase/migrations/` | Postgres schema, RLS policies, storage bucket and policies |
| `src/pages/*` | Screens: trips, trip, destination, place, activity, items, item, settings |
