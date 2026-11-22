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
- **Places library.** Every place you add is saved to your **Places** library (the Places tab), so a hotel or restaurant can be reused on any trip.
  - On a destination, **+ Place** lets you pick from the library or create a new place.
  - **Editing a place updates it on every trip that uses it.**
  - On a trip, a place's **Remove from trip** takes it (and its activities there) off that trip but keeps it in the library.
  - In the library, **Add to a trip** puts a place on any trip, and **Delete** removes it from the library while leaving it on trips that already use it.
- **Move a place**, with its activities, to another destination on the same trip or on another trip (**Move** on the place's page). Activity times stay put if they fit the new trip's dates. Otherwise they shift by the gap between the two trips' start dates, and if they still don't fit, nothing moves and you're told why. You can create the destination as you move.
- **Item types.** Items can have a type such as Shirts, Pants, Jackets & coats, Shoes or Accessories, or one you type yourself (it's then offered for future items). New items get a suggested type from their name ("Navy blazer" → Jackets & coats).
- **Whole-trip items.** Some things belong to the trip rather than one activity, like a passport, chargers or medications. Tap **+ Whole trip** on a trip's packing list to add them. It uses the same picker as activities: search the library or create new items on the spot. A trip with no activities yet can still have a packing list this way.
- **The packing list** for a trip collects every item from every activity, plus its whole-trip items:
  - Group it by **category**, by **type**, by the **day** an item is first needed, or by **destination**. When grouping by type, items without a type fall back to their category. The Day and Destination views start with a **Whole trip** group.
  - Each item shows **every activity it's used on** as a tappable chip with the day and time (plus a **Whole trip** chip if it's on the whole trip), so you can see which other activities that jacket or shirt is worn on. Turn off **Show activities** for a compact list. The Share/copy text includes the activities too.
  - Check items off as you pack, hide packed items, mark everything packed at once, share or copy the list as text, or print it.
  - Tap an item to set how many to pack and to see each activity's place, time and notes.
  - **How many to pack.** Each item has a counting setting:
    - **Same for the whole trip** (default): your black jeans on three activities is still one pair. It uses the largest quantity any single activity asks for.
    - **One per day of the trip**: for socks and underwear. A 6-day trip packs 6, a 3-day trip packs 3. New items named like socks, underwear or t-shirts get this setting automatically.
    - **One per activity**: adds up the quantities across activities.
  - **Change the count for one trip.** Tap an item on the packing list and use **Pack for this trip** to set your own number, for example 4 pairs of socks instead of 6. It only affects that trip, survives ticking the item as packed, and **Use automatic** puts it back.
- **Activity pages** show, under each item, the other activities on the trip that use it.
- **Schedule** view shows the trip day by day.
- **Duplicate** a trip to reuse its whole itinerary on new dates.
- **Copy items** between activities on the same or different trips: on an activity, tap **Copy items…**.
  - **Bring items here** from another activity, or from a trip's whole-trip list.
  - **Send items from here** to another activity or a whole-trip list.
  - Tick exactly which items to copy. Quantities and notes come along, and items already at the destination are skipped. Items aren't duplicated in your library: the same item is linked to the other activity.
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

## Importing from Dataverse

**Settings → Import from Dataverse** connects to a Microsoft Dataverse environment through the Dataverse Web API, using Microsoft sign-in (MSAL, authorization code flow with PKCE). Packlist reads only what the signed-in Microsoft account is allowed to read, and nothing is sent anywhere except Microsoft.

It's built for the **PackList** Dataverse app (tables prefixed `cr282_packlist_`). Tap **Preview import** to see what will come across, then **Import**:

| Dataverse | Packlist |
| --- | --- |
| PackList_Trip (Title, Description, Start, End, Image) | Trip. Dates widen if an activity falls outside them. |
| PackList_Destination (linked to trips many-to-many) | Destination, copied into each trip that uses it |
| PackList_Place (→ Destination) | Place on each trip that uses it, plus one Places library entry. Type guessed from the name (Hotel, Restaurant…), otherwise Other. |
| PackList_Activity (→ Place, → Trip, Start, Stop) | Activity. No stop time means 1 hour. No trip link: inferred from the destination if it's on exactly one trip, otherwise skipped. |
| PackList_Item (Title, Type, Image) | Item. Shirt → Shirts, Pants → Pants, Shoes → Shoes, Socks/Underwear → one per day, Jacket → Jackets & coats, Accessory → Accessories. |
| Item ⇄ Activity (both relationships) | Items on activities |
| Item ⇄ Trip, and ItemCount rows, for items on none of that trip's activities | Whole-trip items |
| PackList_ItemCount (Trip, Item, Count, Packed) | Packed tick, plus a manual count where Count differs from Packlist's automatic count |

- Only active records are imported.
- The preview lists anything skipped or adjusted, and which items become whole-trip items.
- **Importing again updates the same records** instead of creating copies, because record IDs are derived from the Dataverse IDs.
  - A photo added in Packlist is kept if the Dataverse record has none.
  - A count set by hand is kept unless Dataverse has a count for that item.
  - Records deleted in Dataverse aren't deleted from Packlist.
- Dates and times stored in UTC are shown in the device's time zone.
- **Advanced: copy table details** lists any tables' structure (no row data) for troubleshooting.

**One-time setup in Microsoft Entra ID** (a tenant admin does this once):

1. In the [Microsoft Entra admin center](https://entra.microsoft.com), go to **App registrations → New registration**.
   - Name: `Packlist`
   - Supported account types: **Accounts in this organizational directory only**
   - Redirect URI: platform **Single-page application (SPA)**, address `https://kanaloa2.github.io/packlist/auth-redirect.html`
2. On the app's **API permissions** page, choose **Add a permission → Dynamics CRM → Delegated permissions → user_impersonation**, then **Grant admin consent**.
3. Copy the **Application (client) ID** and **Directory (tenant) ID** from the **Overview** page into the Packlist panel. They're saved to your Packlist account (on your Supabase sign-in profile), so you enter them once and every device you sign in on uses them. Each device still signs in to Microsoft once. They're identifiers, not secrets. Don't create a client secret; a browser app can't keep one safe and doesn't need one.

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
| `src/dataverse/` | Microsoft sign-in, Dataverse Web API client, the importer (`importer.ts`: fetch → plan → apply), connection settings synced through the account (`accountSettings.ts`) and the Settings panel |
| `auth-redirect.html` | The page Microsoft's sign-in popup returns to; hands the result to the app |
| `src/pages/*` | Screens: trips, trip, destination, place, activity, items, item, settings |
