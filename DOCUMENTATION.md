# Open Finds — Functions & Workflows Documentation

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Routing (`src/lib/router.ts`)](#routing)
3. [Authentication & Context (`src/context/AuthContext.tsx`)](#auth-context)
4. [Database Layer (`src/lib/supabase.ts`)](#database-layer)
5. [AI / OpenAI Layer (`src/lib/openai.ts`)](#ai-layer)
6. [API Keys & External Services (`src/lib/apiKeys.ts`)](#api-keys)
7. [Utility Libraries](#utility-libraries)
8. [Edge Functions (`supabase/functions/`)](#edge-functions)
9. [Pages & Workflows](#pages-workflows)
10. [Components](#components)
11. [Database Schema](#database-schema)

---

## Architecture Overview

Open Finds is a React + TypeScript single-page application using:
- **Vite** as the build tool
- **Tailwind CSS** for styling (gold-on-black theme)
- **Supabase** for database, authentication, edge functions, and real-time subscriptions
- **Hash-based routing** (no server-side routing)
- **Lucide React** for icons

The app lets users plan multi-stop night outs and multi-day trips, discover venues via AI, save venues from social media links, invite friends via shareable links, and manage RSVPs.

---

## Routing

**File:** `src/lib/router.ts`

### `parseHash(): Route`
Parses `window.location.hash` into a typed `Route` object. Strips query strings before matching segments. Recognizes routes: `home`, `create`, `build`, `saved`, `plan` (with sub-routes `share`, `rsvp`, `confirmed`, `declined`, `dashboard`), `trip` (with sub-routes `rsvp`, `day`), `trip-setup`, `venue-portal`, and `subscription`. A bare `/plan/[id]` is treated as the guest RSVP view so share links work without extra path segments.

### `useRouter(): { route, navigate }`
React hook that tracks the current route via `parseHash()` and listens for `hashchange` events. Returns the current `route` and a `navigate` function.

### `navigate(path: string)`
Imperative navigation function. Sets `window.location.hash` to the given path (prefixing `#` if needed) and scrolls to top.

---

## Auth Context

**File:** `src/context/AuthContext.tsx`

### `AuthProvider`
Wraps the app. On mount, subscribes to `supabase.auth.onAuthStateChange`. When a session is detected, loads the user's profile from the `profiles` table. Exposes:

| Field | Type | Description |
|---|---|---|
| `session` | `Session \| null` | Current Supabase auth session |
| `loading` | `boolean` | True while auth state is being determined |
| `profileLoaded` | `boolean` | True once profile has been fetched (or attempted) |
| `displayName` | `string \| null` | User's display name from profile |
| `username` | `string \| null` | User's username from profile |
| `onboardingCompleted` | `boolean` | Whether user has completed onboarding |
| `dietaryPreferences` | `string[]` | User's saved dietary preference tags |
| `subscriptionTier` | `SubscriptionTier` | Current subscription plan (free / premium_monthly / premium_yearly / lifetime) |
| `isVenuePartner` | `boolean` | Whether the user has a venue partner account |
| `refreshProfile()` | `async () => void` | Re-fetches the profile from the database |
| `setOnboardingCompleted(v)` | `(boolean) => void` | Local state setter for onboarding flag |

On sign-out, all profile state is reset to defaults.

---

## Database Layer

**File:** `src/lib/supabase.ts`

### Supabase Client Setup
Creates a Supabase client with a custom `safeStorage` wrapper around `localStorage` that catches Safari private-mode `SecurityError`. A global fetch wrapper injects an `x-user-id` header on every request for tracing.

### Anonymous User ID
- `getUserId(): string` — Returns a UUID stored in `localStorage` under `onlyfinds_user_id`. Creates one if missing. Used to scope plans, stops, and RSVPs to a device without requiring login.

### Types
- `SubscriptionTier` — 'free' | 'premium_monthly' | 'premium_yearly' | 'lifetime'
- `Profile` — id, display_name, username, onboarding_completed, dietary_preferences, subscription_tier, stripe_customer_id, subscription_status, subscription_renews_at, is_venue_partner, created_at
- `Plan` — id, title, date, host_name, location, type, status, share_link, canceled, user_id, trip_id, day_number, accommodation_name, accommodation_address, created_at
- `Trip` — id, name, destination, start_date, num_days, host_name, status, user_id, share_link, is_paid, created_at
- `Stop` — id, plan_id, name, address, time, vibe_link, sort_order, user_id
- `StopRsvp` — id, stop_id, plan_id, trip_id, name, status, auth_uid, user_id, created_at
- `Rsvp` — id, plan_id, name, status, decline_reason, user_id, auth_uid, created_at
- `RsvpStatus` — 'pending' | 'in' | 'declined'
- `VenueType` — 'food' | 'activity' | 'dessert'
- `SavedVenue` — id, name, address, type, link, user_id, created_at, lat, lon, tags, collection
- `Collection` — id, name, user_id, created_at
- `Friendship` — id, requester_id, addressee_id, status, created_at, updated_at
- `FriendWithProfile` — friendship_id, user_id, display_name, username, status, direction, created_at
- `VenuePartner` — id, owner_id, business_name, address, type, instagram_link, website, contact_name, contact_email, monthly_budget_cents, visit_rate_cents, active, approved, stripe_customer_id, lat, lon, created_at
- `VenueEventType` — 'impression' | 'saved' | 'visited'
- `VenueEvent` — id, venue_id, event_type, plan_id, user_id, auth_uid, created_at
- `VenueMilestone` — id, venue_id, milestone_type, threshold, reached_at, notified, created_at
- `VenueRatingSummary` — venue_id, rating_count, average_rating

### Auth Functions

| Function | Description |
|---|---|
| `signUp(email, password)` | Registers a new user via Supabase auth |
| `signIn(email, password)` | Signs in with email/password |
| `signOut()` | Signs out the current user |
| `updateUserEmail(email)` | Updates the user's email via Supabase auth |
| `updateUserPassword(password)` | Updates the user's password |

### Plan Functions

| Function | Description |
|---|---|
| `fetchPlan(id)` | Fetches a single plan by ID (public, no user_id filter — used for share links) |
| `createPlan(plan)` | Creates a new plan scoped to the anonymous user_id |
| `fetchAllPlans()` | Fetches all non-canceled plans for the current user, ordered by date ascending |
| `fetchCanceledPlans()` | Fetches all canceled plans for the current user, ordered by date descending |
| `markPlanCanceled(id)` | Marks a plan as canceled (soft delete) |
| `deletePlan(id)` | Hard-deletes a plan |
| `updatePlan(id, updates)` | Updates plan fields (title, date, location, type, accommodation) |

### Stop Functions

| Function | Description |
|---|---|
| `fetchStops(planId)` | Fetches all stops for a plan, ordered by sort_order |
| `createStops(planId, stops)` | Bulk-inserts stops with sequential sort_order |
| `replaceStops(planId, stops)` | Deletes all existing stops for a plan, then creates new ones |
| `updateStop(id, updates)` | Updates a single stop (name, address, time, sort_order) |
| `insertStop(planId, stop)` | Inserts a single new stop |
| `deleteStop(id)` | Deletes a single stop |
| `reorderStops(planId, orderedStopIds)` | Updates sort_order for each stop to match the given array order |
| `sortStops(stops)` | Pure helper — sorts stops by time ascending |

### RSVP Functions (Plan-level)

| Function | Description |
|---|---|
| `fetchRsvps(planId)` | Fetches all RSVPs for a plan, ordered by created_at |
| `insertRsvp(rsvp)` | Inserts a new RSVP (used by guests — no auth required) |
| `sendGuestRsvpPushNotification(...)` | Sends a push notification to the plan host when a guest RSVPs |

### Trip Functions (Travel Mode)

| Function | Description |
|---|---|
| `createTrip(trip)` | Creates a new trip scoped to the current user |
| `fetchTrip(id)` | Fetches a single trip by ID (public for share links) |
| `fetchAllTrips()` | Fetches all active trips for the current user |
| `fetchTripDays(tripId)` | Fetches all plans (days) belonging to a trip, ordered by day_number |
| `updateTrip(id, updates)` | Updates trip fields (name, destination, start_date, num_days, status) |
| `deleteTrip(id)` | Hard-deletes a trip |
| `cancelTrip(id)` | Marks a trip as canceled (soft delete) |

### Per-Stop RSVP Functions (Travel Mode)

| Function | Description |
|---|---|
| `fetchStopRsvps(tripId)` | Fetches all per-stop RSVPs for a trip |
| `fetchStopRsvpsByPlan(planId)` | Fetches per-stop RSVPs for a single day/plan |
| `insertStopRsvp(rsvp)` | Inserts a new per-stop RSVP |
| `upsertStopRsvp(stopId, planId, tripId, name, status)` | Updates existing RSVP for a (stop, name) pair, or inserts if none exists |

### Saved Venue Functions

| Function | Description |
|---|---|
| `fetchSavedVenues(limit?)` | Fetches all saved venues for the authenticated user, newest first |
| `insertSavedVenue(venue)` | Saves a new venue (RLS-scoped to auth.uid) |
| `deleteSavedVenue(id)` | Deletes a saved venue |
| `updateSavedVenue(id, updates)` | Updates venue fields (name, address, type, tags, collection) |
| `updateSavedVenueCoords(id, lat, lon)` | Updates stored coordinates for a saved venue |

### Collection Functions

| Function | Description |
|---|---|
| `fetchCollections()` | Fetches all collections for the current user |
| `createCollection(name)` | Creates a new collection |
| `renameCollection(id, name)` | Renames a collection |
| `deleteCollection(id)` | Deletes a collection |
| `addVenueToCollection(collectionId, venueId)` | Links a venue to a collection (ignores duplicate errors) |
| `removeVenueFromCollection(collectionId, venueId)` | Unlinks a venue from a collection |
| `fetchVenueCollectionIds(venueId)` | Returns all collection IDs a venue belongs to |
| `fetchCollectionVenueIds(collectionId)` | Returns all venue IDs in a collection |
| `fetchAllCollectionMemberships()` | Returns a map of venue_id -> [collection_id] for all memberships |

### Profile Functions

| Function | Description |
|---|---|
| `fetchProfile(userId)` | Fetches a user's profile by ID |
| `upsertProfile(displayName, username?)` | Creates or updates the current user's profile |
| `completeOnboarding()` | Sets `onboarding_completed = true` for the current user |
| `resetOnboarding()` | Sets `onboarding_completed = false` for the current user |
| `updateDietaryPreferences(preferences)` | Saves dietary preference tags (or NULL if empty) to the current user's profile |
| `checkUsernameAvailable(username)` | Returns true if the username is available, or already belongs to the current user |
| `searchUserByUsername(query)` | Case-insensitive username search (strips leading @), returns a Profile or null |

### Friend Functions

| Function | Description |
|---|---|
| `sendFriendRequest(targetUserId)` | Creates a pending friendship and sends a notification + push to the target |
| `acceptFriendRequest(friendshipId)` | Sets friendship status to accepted, notifies the original requester |
| `declineFriendRequest(friendshipId)` | Sets friendship status to declined |
| `removeFriend(friendshipId)` | Deletes the friendship record |
| `fetchFriends()` | Returns all accepted friends for the current user |
| `fetchPendingFriendRequests()` | Returns incoming pending friend requests |
| `fetchOutgoingFriendRequests()` | Returns outgoing pending friend requests |

### Guest Functions

| Function | Description |
|---|---|
| `getGuestName()` | Returns the guest name stored in localStorage |
| `setGuestName(name)` | Stores a guest name in localStorage |
| `fetchConfirmedPlanIds(guestName)` | Returns plan IDs where this guest name has RSVP'd "in" |
| `fetchPlansByIds(ids)` | Fetches non-canceled plans by a list of IDs |

### Notification Functions

| Function | Description |
|---|---|
| `fetchNotifications()` | Fetches all notifications for the current user |
| `fetchUnreadNotificationCount()` | Returns the count of unread notifications |
| `markNotificationRead(id)` | Marks a single notification as read |
| `markAllNotificationsRead()` | Marks all notifications as read for the current user |
| `subscribeToPush()` | Registers the device for push notifications via the service worker |
| `sendPushNotification(...)` | Sends a push notification to a specific user via the edge function |

### Venue Partner Functions

| Function | Description |
|---|---|
| `fetchVenuePartner()` | Fetches the venue partner profile for the current authenticated user |
| `createVenuePartner(partner)` | Registers a new venue partner (sets is_venue_partner flag on profile) |
| `updateVenuePartner(id, updates)` | Updates venue partner fields (name, address, type, links, budget, rate, active) |
| `fetchVenueEvents(venueId)` | Fetches up to 500 recent tracking events for a venue |
| `recordVenueEvent(venueId, eventType, planId?)` | Records an impression, save, or visit event |
| `fetchVenueMilestones(venueId)` | Fetches milestone records for a venue |
| `fetchVenueEventStats(venueId, visitRateCents)` | Returns aggregate counts (impressions, saves, visits, thisMonthVisits, thisMonthSpendCents) |

### Venue Rating Functions

| Function | Description |
|---|---|
| `fetchVenueRatingSummary(venueId)` | Returns the public aggregate (count + average) for a single venue |
| `fetchVenueRatingSummaries(venueIds)` | Batch-fetches rating summaries for multiple venues, returns a map keyed by venue_id |
| `fetchUserVenueRating(venueId)` | Returns the current user's rating for a venue (1–5), or null |
| `upsertVenueRating(venueId, rating)` | Creates or updates the current user's rating for a venue |

### Subscription Functions

| Function / Constant | Description |
|---|---|
| `SUBSCRIPTION_PLANS` | Constant object keyed by tier — each has label, priceCents, maxPlans, maxStopsPerPlan, ads flag |
| `getPlanLimits(tier)` | Returns the plan limits object for a given tier (falls back to free) |
| `updateSubscriptionTier(tier)` | Updates the current user's subscription_tier and sets status to active |

---

## AI Layer

**File:** `src/lib/openai.ts`

All AI calls go through the `ai-proxy` edge function (server-side), which holds the OpenAI API key.

### `callAI(messages, opts?): Promise<string>`
Private function. Sends chat messages to the `ai-proxy` edge function. Supports `temperature` and `responseFormat` (json_object). Throws on HTTP errors or empty responses.

### `fetchPageMeta(url): Promise<MetaResult | null>`
Private function. Calls the `extract-venue-meta` edge function to scrape page metadata (og:title, og:description, JSON-LD, oEmbed, raw text, handle detection, platform/content-type detection).

### `buildExtractionPrompt(meta, link): string`
Private function. Builds a context string from page metadata for the AI. Contains platform-specific guidance for Instagram reels/videos, posts, profiles, Facebook pages, TikTok, and generic websites. Handles the case where the creator IS the venue vs. the content features venues.

### `normalizeType(raw): VenueType | null`
Private function. Maps free-text type strings to one of `food`, `activity`, `dessert` using keyword matching.

### `extractVenuesFromLink(link): Promise<ExtractedVenueItem[]>`
Takes any social media or website link. If it's a Google Maps link, resolves directly via `resolveGoogleMapsLink`. Otherwise: (1) fetches page metadata via edge function, (2) builds context, (3) asks AI to extract all venues mentioned (name, full address, type, tags, coordinates), (4) validates and sorts results by order of appearance. Returns an array of venue items.

### `extractVenueFromLink(link): Promise<ExtractedVenue>`
Wrapper around `extractVenuesFromLink` that returns only the first venue found (or null fields if none).

### `discoverVenueCandidates(vibe, location): Promise<VenueCandidate[]>`
Basic discovery — asks AI to find 8 real venues of a given type near a location. No personalization.

### `discoverSmartVenueCandidates(vibes, location, savedVenues, travelTimeMinutes?, dietaryPreferences?): Promise<VenueCandidate[]>`
Personalized discovery. Builds a prompt that includes:
- **Vibe labels** — maps selected vibes to human-readable descriptions
- **Taste guidance** — summarizes the user's saved venues so the AI understands their preferences (cuisine, price, atmosphere, suburbs)
- **Travel time hint** — prioritizes venues within the user's max driving time
- **Dietary requirements** — instructs the AI to ONLY recommend venues that can accommodate the user's dietary needs (vegetarian, vegan, gluten-free, halal, kosher, dairy-free, nut-free, pescatarian)
- **Exclusion list** — names of already-saved venues to avoid suggesting

Returns 8 venue candidates with name, address, type, and optional vibe_link (Instagram/website).

---

## API Keys

**File:** `src/lib/apiKeys.ts`

### `fetchDistanceMatrix(origin, destinations): Promise<VenueDistance[] | null>`
Calls the `travel-times` edge function. Origin can be a street address (geocoded server-side) or a `{lat, lon}` pair (skips geocoding). Destinations can include pre-stored coordinates. Returns driving duration in seconds and text for each destination.

### `isGoogleMapsLink(url): boolean`
Checks if a URL is a Google Maps link (google.com/maps, maps.google.com, maps.app.goo.gl).

### `resolveGoogleMapsLink(url): Promise<ResolvedPlace | null>`
Calls the `resolve-place` edge function to extract name, address, and coordinates from a Google Maps short link.

### `geocodeAddress(address): Promise<{lat, lon} | null>`
Calls the `geocode` edge function to convert a street address to coordinates.

---

## Utility Libraries

### `src/lib/invite.ts`

| Function | Description |
|---|---|
| `buildInviteMessage(plan)` | Builds a text invite message with host name, event title, formatted date, and RSVP share URL |
| `getShareUrl(planId)` | Returns the `#/plan/[id]/rsvp` share URL |
| `copyToClipboard(text)` | Copies text to clipboard, returns success boolean |
| `shareOrCopy(title, text, url)` | Uses the Web Share API if available, otherwise falls back to clipboard copy |

### `src/lib/countdown.ts`

| Function | Description |
|---|---|
| `useCountdown(targetDate)` | React hook that ticks every second, returning `{days, hours, minutes, seconds, isPast}` |
| `formatCountdown(c)` | Formats days/hours/minutes into a human-readable string |

### `src/lib/time.ts`

| Function | Description |
|---|---|
| `formatTime(time)` | Converts 24h time ("19:15") to 12h with AM/PM ("7:15 PM") |

---

## Edge Functions

All edge functions run on Supabase's Deno runtime and are called from the client.

### `ai-proxy/index.ts`
Receives chat messages and options (temperature, response_format), forwards them to OpenAI's Chat Completions API using a server-side API key, and returns the response. This keeps the OpenAI key secret.

### `extract-venue-meta/index.ts`
Fetches a URL's HTML, extracts metadata: og:title, og:description, og:site_name, meta description, JSON-LD structured data, oEmbed data (title, author, html), page title, raw text excerpt. Detects platform (Instagram, Facebook, TikTok, Google Maps, generic website) and content type (reel, video, post, profile, website). Returns a `MetaResult` object.

### `geocode/index.ts`
Receives an address string, calls Google Maps Geocoding API (server-side key), returns `{lat, lon}`.

### `resolve-place/index.ts`
Receives a Google Maps short link, follows redirects to resolve the full URL, then calls Google Maps Places API to extract the place name, address, and coordinates.

### `send-push-notification/index.ts`
Receives a user ID, title, body, and data payload. Looks up the user's push subscription from the database and sends a web push notification via the Web Push API (server-side VAPID keys).

### `travel-times/index.ts`
Receives an origin (address or coordinates) and a list of destinations (with optional pre-stored coordinates). Geocodes any missing coordinates via Google Maps, then calls the Google Maps Distance Matrix API to get driving durations. Returns an array of `VenueDistance` results.

---

## Pages & Workflows

### `App.tsx` — Root Application
Manages top-level view state (home, events, venues, friends, settings), dashboard overlay, edit-plan mode, notifications panel, and onboarding gate. Routes guest-facing pages (rsvp, confirmed, declined, share, trip, trip-rsvp, trip-day, trip-setup) without auth. Shows a blank screen during auth loading to prevent flash of login page.

### `Home.tsx` — Main Planning Flow
The largest page. Contains a multi-step wizard with these sub-pages:
1. **hero** — Landing screen with "Plan My Night" and "Something New" options
2. **occasion** — Event name and date input
3. **planMyNight** — Choose saved venues to build an itinerary
4. **randomNight** — AI generates a random night based on vibes + location + travel time
5. **somethingNew** — AI discovers new venues matching the user's taste, with dietary filter chips. Saved profile preferences are auto-applied; ad-hoc chips add extra filters for the current search
6. **savedVenuesSelect** — Pick from previously saved venues
7. **sponsored** — Sponsored venue suggestions
8. **itinerary** — Review and edit the multi-stop itinerary with times
9. **share** — Copy link, invite friends, RSVP, share on social

Key workflows:
- **Vibe selection** — User picks 1-3 of: Food, Activity, Dessert
- **Travel time slider** — 0 to 240+ minutes max drive
- **Location** — Suburb/postcode text input or "use my location" (GPS)
- **Dietary filters** — Chip selector combining saved preferences with ad-hoc selections
- **AI discovery** — Calls `discoverSmartVenueCandidates` with vibes, location, saved venues, travel time, and dietary preferences
- **Distance matrix** — After discovery, fetches driving times from origin to each venue
- **Save discovered venue** — One-tap save to the user's saved venues collection
- **Create plan** — Saves the plan + stops to the database, generates a share link

### `Login.tsx` — Authentication
Email/password sign-up and sign-in. First-time users are prompted to enter a display name.

### `Onboarding.tsx` — First-Run Walkthrough
A 5-step modal walkthrough:
1. Save Venues from Links
2. Plan a Night Out
3. Invite Your Friends
4. Plan Trips Too
5. Dietary Preferences — tappable pills to select dietary needs, saved to profile

Includes a "Do not show again" checkbox. Skip button exits early.

### `Dashboard.tsx` — Plan Details
Shows a single plan with countdown timer, stop list, RSVP status, and management actions (edit, cancel, delete, copy link).

### `Events.tsx` — Event List
Lists all upcoming and canceled plans. Clicking a plan opens the dashboard.

### `Venues.tsx` — Saved Venues
Manage saved venues. Add venues via link extraction or manual entry. Organize into collections. Edit/delete venues. View on Google Maps.

### `Friends.tsx` — Social
Search users by username, send/accept/decline friend requests, view friends list.

### `Notifications.tsx` — Notification Center
View and manage notifications (friend requests, friend acceptances, RSVPs). Mark individual or all as read.

### `Settings.tsx` — User Settings
Edit display name, username, email, password. Manage dietary preferences (chip selector with save button). View current subscription plan and link to subscription manager. Link to venue partner portal (or register as a venue partner). Replay onboarding. Sign out.

### `VenuePortal.tsx` — Venue Partner Portal
Business owners register their venue (business name, address, type, Instagram, website, contact details, monthly budget, per-visit rate). The dashboard shows impression/save/visit stats, monthly spend with budget cap progress bar, milestone progress toward 10/50/100/500 thresholds, and pause/resume promotion toggle. Profile editing allows updating all fields. New venues require admin approval before going live.

### `Subscription.tsx` — Subscription Manager
Displays four subscription tiers (Free, Premium Monthly $4.99, Premium Yearly $29.99, Lifetime $49.99) with full feature comparison lists. Shows the current plan and allows switching. Note: real payment processing requires connecting a Stripe account — currently updates the tier directly in the database.

### `Rsvp.tsx` — Guest RSVP (no auth required)
Guests receive a share link, enter their name, and respond "I'm in" or "Can't make it". Sends a push notification to the host.

### `Confirmed.tsx` — RSVP Confirmed
Confirmation screen shown after a guest accepts.

### `Declined.tsx` — RSVP Declined
Screen shown after a guest declines, with optional decline reason.

### `PlanView.tsx` — Shared Plan View
Public view of a plan for guests who haven't RSVP'd yet.

### `TripSetup.tsx` — Trip Creation
Create a multi-day trip: name, destination, start date, number of days.

### `TripOverview.tsx` — Trip Dashboard
View all days of a trip, navigate to individual days, share the trip link.

### `TripDay.tsx` — Single Day Editor
Edit stops for a single day of a trip. Add venues, reorder stops, set times.

### `TripRsvp.tsx` — Trip Guest RSVP
Guests can RSVP per-stop for each day of a trip.

### `CreatePlan.tsx` / `PlanBuilder.tsx` — Plan Creation Helpers
Supporting pages for the plan creation flow.

---

## Components

| Component | File | Description |
|---|---|---|
| `Onboarding` | `Onboarding.tsx` | 5-step first-run walkthrough including dietary preferences |
| `Confetti` | `Confetti.tsx` | Celebration confetti animation (canvas-based) |
| `HelpTooltip` | `HelpTooltip.tsx` | Info icon with hover/tap tooltip |
| `InviteFriendsModal` | `InviteFriendsModal.tsx` | Modal for inviting friends to a plan |
| `SavedVenueCard` | `SavedVenueCard.tsx` | Card displaying a saved venue with actions |
| `SavedVenuesModal` | `SavedVenuesModal.tsx` | Modal for selecting from saved venues |
| `ScrollHint` | `ScrollHint.tsx` | Animated scroll indicator |
| `Shared` | `Shared.tsx` | Shared UI elements (buttons, inputs, etc.) |
| `StopCard` | `StopCard.tsx` | Card displaying a single stop in an itinerary |
| `ViewToggle` | `ViewToggle.tsx` | Bottom navigation bar (Home, Events, Venues, Friends, Settings) |

---

## Database Schema

### `profiles`
| Column | Type | Description |
|---|---|---|
| id | uuid (PK) | Matches auth.users.id |
| display_name | text | User's display name |
| username | text, nullable | Unique username |
| onboarding_completed | boolean | Has completed onboarding |
| dietary_preferences | text[], nullable | Array of dietary tags |
| subscription_tier | text | free / premium_monthly / premium_yearly / lifetime (default free) |
| stripe_customer_id | text, nullable | Stripe customer ID for billing |
| subscription_status | text | active / canceled / past_due (default active) |
| subscription_renews_at | timestamptz, nullable | Next renewal date |
| is_venue_partner | boolean | Whether user has a venue partner account (default false) |
| created_at | timestamptz | Record creation time |

### `plans`
| Column | Type | Description |
|---|---|---|
| id | uuid (PK) | Plan ID |
| title | text | Event name |
| date | date | Event date |
| host_name | text | Host's display name |
| location | text, nullable | General area |
| type | text | Comma-separated vibes |
| status | text | Plan status |
| share_link | text, nullable | Share URL |
| canceled | boolean | Soft-delete flag |
| user_id | text | Anonymous user ID |
| trip_id | uuid, nullable | Parent trip (if part of a trip) |
| day_number | int, nullable | Day number within trip |
| accommodation_name | text, nullable | Hotel/accommodation name (trips) |
| accommodation_address | text, nullable | Hotel address (trips) |
| created_at | timestamptz | Record creation time |

### `stops`
| Column | Type | Description |
|---|---|---|
| id | uuid (PK) | Stop ID |
| plan_id | uuid (FK) | Parent plan |
| name | text | Venue name |
| address | text | Full street address |
| time | text | Stop time (24h) |
| vibe_link | text, nullable | Instagram/website link |
| sort_order | int | Display order |
| user_id | text | Anonymous user ID |

### `rsvps`
| Column | Type | Description |
|---|---|---|
| id | uuid (PK) | RSVP ID |
| plan_id | uuid (FK) | Parent plan |
| name | text | Guest name |
| status | text | pending / in / declined |
| decline_reason | text, nullable | Reason if declined |
| user_id | text | Anonymous user ID |
| auth_uid | uuid, nullable | Auth user ID if logged in |
| created_at | timestamptz | Record creation time |

### `trips`
| Column | Type | Description |
|---|---|---|
| id | uuid (PK) | Trip ID |
| name | text | Trip name |
| destination | text | Destination city/area |
| start_date | date | Trip start date |
| num_days | int | Number of days |
| host_name | text | Host's display name |
| status | text | active / canceled |
| user_id | text | Anonymous user ID |
| share_link | text, nullable | Share URL |
| is_paid | boolean | Premium trip flag |
| created_at | timestamptz | Record creation time |

### `stop_rsvps`
| Column | Type | Description |
|---|---|---|
| id | uuid (PK) | RSVP ID |
| stop_id | uuid (FK) | Parent stop |
| plan_id | uuid (FK) | Parent plan/day |
| trip_id | uuid, nullable | Parent trip |
| name | text | Guest name |
| status | text | in / out |
| auth_uid | uuid, nullable | Auth user ID |
| user_id | text, nullable | Anonymous user ID |
| created_at | timestamptz | Record creation time |

### `saved_venues`
| Column | Type | Description |
|---|---|---|
| id | uuid (PK) | Venue ID |
| name | text | Venue name |
| address | text | Full address |
| type | text | food / activity / dessert |
| link | text, nullable | Source link |
| user_id | uuid | Auth user ID (RLS-scoped) |
| lat | float, nullable | Latitude |
| lon | float, nullable | Longitude |
| tags | text[], nullable | Cuisine/style tags |
| collection | text, nullable | Collection name |
| created_at | timestamptz | Record creation time |

### `collections`
| Column | Type | Description |
|---|---|---|
| id | uuid (PK) | Collection ID |
| name | text | Collection name |
| user_id | uuid | Auth user ID |
| created_at | timestamptz | Record creation time |

### `collection_venues` (junction table)
| Column | Type | Description |
|---|---|---|
| collection_id | uuid (FK) | Parent collection |
| venue_id | uuid (FK) | Saved venue |

### `friendships`
| Column | Type | Description |
|---|---|---|
| id | uuid (PK) | Friendship ID |
| requester_id | uuid | Who sent the request |
| addressee_id | uuid | Who received the request |
| status | text | pending / accepted / declined |
| created_at | timestamptz | Record creation time |
| updated_at | timestamptz | Last update time |

### `notifications`
| Column | Type | Description |
|---|---|---|
| id | uuid (PK) | Notification ID |
| user_id | uuid | Recipient |
| type | text | friend_request / friend_accepted / rsvp / etc. |
| title | text | Notification title |
| body | text | Notification body |
| data | jsonb | Extra payload |
| read | boolean | Read flag |
| created_at | timestamptz | Record creation time |

### `venue_partners`
| Column | Type | Description |
|---|---|---|
| id | uuid (PK) | Venue partner ID |
| owner_id | uuid (FK) | auth.users.id — business owner |
| business_name | text | Venue business name |
| address | text | Full street address |
| type | text | food / activity / dessert |
| instagram_link | text, nullable | Instagram profile URL |
| website | text, nullable | Website URL |
| contact_name | text | Contact person name |
| contact_email | text | Contact email |
| monthly_budget_cents | int, nullable | Monthly spending cap (null = unlimited) |
| visit_rate_cents | int | Cost per confirmed visit (default 50 = $0.50) |
| active | boolean | Whether promotion is live (default true) |
| approved | boolean | Admin approval flag (default false) |
| stripe_customer_id | text, nullable | Stripe customer for billing |
| lat | float, nullable | Latitude |
| lon | float, nullable | Longitude |
| created_at | timestamptz | Record creation time |

RLS: owner-scoped (auth.uid = owner_id) for all CRUD.

### `venue_events`
| Column | Type | Description |
|---|---|---|
| id | uuid (PK) | Event ID |
| venue_id | uuid (FK) | Parent venue_partners row |
| event_type | text | impression / saved / visited |
| plan_id | uuid, nullable | Associated plan if any |
| user_id | text, nullable | Anonymous or auth user ID |
| auth_uid | uuid, nullable | Auth user ID if logged in |
| created_at | timestamptz | Event timestamp |

RLS: venue owners can SELECT their own events; any authenticated user can INSERT (tracking).

### `venue_milestones`
| Column | Type | Description |
|---|---|---|
| id | uuid (PK) | Milestone ID |
| venue_id | uuid (FK) | Parent venue_partners row |
| milestone_type | text | visits / impressions / saves |
| threshold | int | Milestone target (10, 50, 100, 500) |
| reached_at | timestamptz | When milestone was reached |
| notified | boolean | Whether owner was notified (default false) |
| created_at | timestamptz | Record creation time |

RLS: owner-scoped via venue_partners ownership check.

### `venue_ratings`
| Column | Type | Description |
|---|---|---|
| id | uuid (PK) | Rating ID |
| venue_id | uuid (FK) | Parent venue_partners row |
| user_id | uuid (FK) | auth.users.id — rater |
| rating | int | 1–5 star rating |
| created_at | timestamptz | First rated time |
| updated_at | timestamptz | Last updated time |

Unique constraint on (venue_id, user_id) — one rating per user per venue.
RLS: public SELECT (anon + authenticated); authenticated users can INSERT/UPDATE/DELETE only their own rating.

### `venue_rating_summary` (view)
| Column | Type | Description |
|---|---|---|
| venue_id | uuid | Grouped venue ID |
| rating_count | int | Total number of ratings |
| average_rating | numeric(3,2) | Average score (0 if no ratings) |

Public aggregate view — granted SELECT to anon and authenticated roles.

---

## Key Workflows Summary

### 1. Plan a Night Out
User picks occasion -> selects vibes (Food/Activity/Dessert) -> sets travel time -> enters location -> AI discovers venues or user picks from saved -> reviews itinerary -> saves plan -> shares link with friends -> friends RSVP via link (no account needed) -> host sees live RSVP status

### 2. Something New (AI Discovery)
User selects vibes -> dietary preferences auto-applied from profile + optional ad-hoc chips -> AI searches web for 8 real venues matching taste + dietary needs + travel time -> driving times fetched -> user saves interesting venues -> builds itinerary

### 3. Save Venue from Link
User pastes Instagram/Facebook/TikTok/website/Google Maps link -> edge function scrapes metadata -> AI extracts venue name, address, type, tags, coordinates -> venue saved to collection

### 4. Trip Planning
User creates trip (name, destination, dates, days) -> each day is a plan with stops -> per-stop RSVPs for friends -> share trip link

### 5. Friends & Social
Search by username -> send friend request -> recipient gets notification + push -> accept/decline -> manage friends list

### 6. Dietary Preferences
Set during onboarding or in Settings -> stored as text array on profile -> auto-applied to all AI discovery searches -> can add ad-hoc filters per search

### 7. Venue Partner Portal
Business owner registers venue (name, address, type, links, contact, budget, per-visit rate) -> venue requires admin approval -> once approved, venue appears in sponsored suggestions -> impressions and saves are free, visits are billed at the per-visit rate -> monthly spend tracked against budget cap -> milestones tracked at 10/50/100/500 for visits, impressions, and saves -> owner can pause/resume promotion at any time

### 8. Subscriptions
User views available plans in Settings -> opens subscription manager -> selects Free, Premium Monthly ($4.99/mo), Premium Yearly ($29.99/yr), or Lifetime ($49.99 one-time) -> tier updated on profile -> free tier limited to 3 plans and 2 stops per plan with ads; premium tiers get unlimited plans, 5 stops per plan, multi-day trips, and no ads. Note: real payment processing requires connecting a Stripe account — currently the tier is updated directly in the database.

---

## Current Feature Handoff Notes

### Saved venue improvements
- Editing a venue address now geocodes the new address and replaces the stored latitude/longitude. If geocoding cannot find the address, the coordinates are cleared instead of leaving a stale map location.
- Saved venues support a private personal note, a 1–5 rating, and a Been here flag. These fields are owner-only through the existing `saved_venues` row policies.
- The Venues screen can filter tags by dietary terms such as `vegan`, `halal`, `vegetarian`, and `gluten-free`.
- Venue cards show visited status, rating, and notes. Collection deletion asks for confirmation; saved venue rows are not deleted with the collection.
- New fields were added additively in migration `20260824120000_add_saved_venue_preferences`; no existing venue data is removed.

### Friends, groups, and shared collections
- The intended test path is: create two accounts, set usernames, search from account A, send a request, accept from account B, then verify both friend lists.
- The recipient should see the request in the Friends screen and Notifications screen. Push delivery additionally requires a device subscription and browser permission.
- Group and shared collection membership is now included when loading the current user's groups and collections, not only records they own.
- Test owner actions and member actions separately: create, add an accepted friend, remove a member, add a venue, remove a venue, and delete the parent group or collection.
- Friend, group, collection, notification, and push tables are authenticated and RLS-scoped. If a social action fails, check the browser-visible error and the matching policy before changing the UI.

### Link extraction support
- Supported platform detection includes Instagram, Facebook, TikTok, YouTube, Google Maps links, and generic websites.
- YouTube links are classified as video content and use page metadata plus JSON-LD/raw text for extraction. No YouTube API key is required for the metadata path.
- Reels and videos require testing in both cases: the creator may be the venue, or the content may feature multiple venues. `extractVenuesFromLink` returns all validated venues in content order.
- Google Maps links use place resolution so the name, address, and coordinates can be saved directly.

### Trips and calendar sharing
- Trips remain an optional secondary workflow: create a trip, configure days, add or reorder stops, add accommodation, share the trip, and test per-stop RSVPs.
- Plans already expose calendar export where applicable. Verify the generated event on both desktop and mobile before launch.

### Venue partner portal, subscriptions, and ratings
- The venue partner portal is accessible from Settings. A user can register as a venue partner by filling out the signup form (business name, address, type, Instagram, website, contact, budget, per-visit rate). New registrations default to `approved = false` and require admin approval before going live.
- The venue dashboard shows three stat cards (impressions, saves, visits), a monthly billing summary with budget cap progress bar, and milestone progress bars for visits/impressions/saves at 10/50/100/500 thresholds.
- Venue events are tracked via the `venue_events` table. Any authenticated user can insert events (impressions, saves, visits). Only the venue owner can read their own events.
- Public community ratings are stored in `venue_ratings` (1–5 stars, one per user per venue). The `venue_rating_summary` view exposes only the aggregate count and average — no individual rater information is public.
- Subscription tiers (free, premium_monthly, premium_yearly, lifetime) are stored on the `profiles` table. The `SUBSCRIPTION_PLANS` constant defines plan limits (max plans, max stops per plan, ads). The subscription manager page lets users switch tiers.
- **Stripe is not yet connected.** The subscription buttons currently update the tier directly in the database without processing a real payment. To enable real billing, connect a Stripe account at `https://bolt.new/setup/stripe`, then wire up checkout sessions for subscription plans and automatic per-visit billing for venue partners.
- Migration: `20260824130000_create_venue_partner_and_subscription_schema` creates all new tables and adds subscription fields to profiles.

### Launch test checklist
1. Edit a saved venue's address and confirm the map destination changes.
2. Add a venue manually and from a link; confirm both appear after a reload.
3. Filter saved venues with a dietary tag and clear the filter.
4. Rate, note, and mark a venue visited; reload and confirm the values persist.
5. Complete a friend request and acceptance with two accounts.
6. Add the accepted friend to a group and shared collection, then verify both accounts can see the shared records.
7. Test Instagram, Facebook, TikTok, YouTube, Google Maps, and a generic website link.
8. Create a trip and verify day stops, sharing, and per-stop RSVP behavior.
9. Register as a venue partner from Settings; confirm the dashboard shows stats and the profile can be edited.
10. Open the subscription manager from Settings; confirm the current plan is shown and switching tiers works.
11. Rate a venue partner venue and confirm the average updates in the rating summary view.
