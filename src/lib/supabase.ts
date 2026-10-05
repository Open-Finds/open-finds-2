import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Catches Safari private-mode SecurityError so the app never crashes on startup,
// while still persisting sessions normally in regular browsers.
const safeStorage = {
  getItem: (key: string): string | null => {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setItem: (key: string, value: string): void => {
    try { localStorage.setItem(key, value); } catch { /* private mode — nothing to persist to */ }
  },
  removeItem: (key: string): void => {
    try { localStorage.removeItem(key); } catch { /* private mode — nothing to remove */ }
  },
};

/**
 * How this page was opened from an auth email or sign-in redirect, read
 * before the client takes the session out of the URL (it then clears the
 * #access_token=… part). Hash routes (#/plan/…) carry no such parameters.
 */
const authRedirect = (() => {
  try {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return { type: params.get('type'), error: params.get('error_description') };
  } catch {
    return { type: null, error: null };
  }
})();

/** Opened from a password-reset email: the app asks for a new password. */
export const arrivedFromPasswordReset = authRedirect.type === 'recovery';

/** Why an email link didn't work (e.g. it expired), for the sign-in screen. */
export const authLinkError: string | null = authRedirect.error;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: safeStorage,
    persistSession: true,
    autoRefreshToken: true,
    // Password-reset emails and Google/Facebook sign-in come back with the
    // session in the URL. The implicit flow puts it in the hash, so the link
    // works on whichever device or browser opens the email.
    detectSessionInUrl: true,
    flowType: 'implicit',
  },
  global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers ?? {});
      try {
        headers.set('x-user-id', getUserId());
      } catch { /* getUserId may not have an ID yet — safe to skip */ }
      return fetch(input, { ...init, headers });
    },
  },
});

/* ── Auth ── */

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/** Emails a link that signs the user in and asks for a new password. */
export async function sendPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // No hash route here: the reset link appends its own #access_token=….
    redirectTo: `${window.location.origin}/`,
  });
  if (error) throw error;
}

export type OAuthProvider = 'google' | 'facebook';

/** Leaves for Google/Facebook; the session is picked up from the URL on return. */
export async function signInWithProvider(provider: OAuthProvider) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}/` },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function updateUserEmail(email: string) {
  const { error } = await supabase.auth.updateUser({ email });
  if (error) throw error;
}

export async function updateUserPassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

/* ── Anonymous user ID (used for plans / stops / rsvps — no login required) ── */

const USER_ID_KEY = 'onlyfinds_user_id';
const GUEST_KEY = 'onlyfinds_guest_key';

/**
 * Identifies this browser when RSVPing as a guest.
 *
 * Kept separate from the device ownership id: that one is transitional and will
 * be retired once every plan has an owner, whereas guest identity is permanent.
 * Per-stop RSVPs used to be keyed on the typed name, so two guests called "Sam"
 * overwrote each other's answer.
 */
export function getGuestKey(): string {
  let key = safeStorage.getItem(GUEST_KEY);
  if (!key) {
    key = crypto.randomUUID();
    safeStorage.setItem(GUEST_KEY, key);
  }
  return key;
}

export function getUserId(): string {
  let id = safeStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    safeStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

/**
 * The signed-in user's id, or null when browsing anonymously.
 *
 * Plans and trips are moving from the device id to this. New rows written by a
 * signed-in user are stamped with it immediately; older rows are adopted by
 * claimDeviceRows() below.
 */
async function getAuthUserId(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Adopts this device's plans and trips into the signed-in account.
 *
 * Nothing in the database links a localStorage device id to an account — the
 * browser is the only place that association exists — so this runs client-side
 * on sign-in. It only ever touches rows that have no owner yet, and once a row
 * is claimed the device id stops granting access to it.
 *
 * Returns how many rows were adopted, or null if the call could not be made.
 */
export async function claimDeviceRows(): Promise<{ plans: number; trips: number } | null> {
  try {
    const { data, error } = await supabase.rpc('claim_device_rows', {
      p_device_id: getUserId(),
    });
    if (error) throw error;
    return data as { plans: number; trips: number };
  } catch {
    // Non-fatal: the user keeps device-scoped access and the next sign-in retries.
    return null;
  }
}

/* ── Types ── */

export type SubscriptionTier = 'free' | 'premium_monthly' | 'premium_yearly' | 'lifetime';

export type Profile = {
  id: string;
  display_name: string;
  username: string | null;
  onboarding_completed: boolean;
  dietary_preferences: string[] | null;
  subscription_tier: SubscriptionTier;
  stripe_customer_id: string | null;
  subscription_status: string;
  subscription_renews_at: string | null;
  is_venue_partner: boolean;
  /** Access level: everyone is a user; staff manage venue partners; admins also run the team. */
  role: AppRole;
  created_at: string;
};

export type AppRole = 'user' | 'staff' | 'admin';

export type Plan = {
  id: string;
  /** auth.users id once the plan has been claimed; null for device-only rows. */
  owner_id?: string | null;
  title: string;
  date: string;
  host_name: string;
  location: string | null;
  type: string;
  status: string;
  share_link: string | null;
  canceled: boolean;
  user_id: string;
  trip_id: string | null;
  day_number: number | null;
  accommodation_name: string | null;
  accommodation_address: string | null;
  created_at: string;
};

export type Trip = {
  id: string;
  /** auth.users id once the trip has been claimed; null for device-only rows. */
  owner_id?: string | null;
  name: string;
  destination: string;
  start_date: string;
  num_days: number;
  host_name: string;
  status: string;
  user_id: string;
  share_link: string | null;
  is_paid: boolean;
  created_at: string;
};

export type StopRsvp = {
  id: string;
  /** Per-browser guest identity; null for signed-in users, who key on auth_uid. */
  guest_key?: string | null;
  stop_id: string;
  plan_id: string;
  trip_id: string | null;
  name: string;
  status: 'in' | 'out';
  auth_uid: string | null;
  user_id: string | null;
  created_at: string;
};

export type Stop = {
  id: string;
  plan_id: string;
  name: string;
  address: string;
  time: string;
  vibe_link: string | null;
  sort_order: number;
  user_id: string;
};

export type RsvpStatus = 'pending' | 'in' | 'declined';

export type Rsvp = {
  id: string;
  plan_id: string;
  name: string;
  status: RsvpStatus;
  decline_reason: string | null;
  user_id: string;
  auth_uid: string | null;
  created_at: string;
  /** The host's own RSVP, added automatically when the plan is created. */
  is_host?: boolean;
};

export type VenueType = 'food' | 'activity' | 'dessert' | 'bar';

export type SavedVenue = {
  id: string;
  name: string;
  address: string;
  type: VenueType;
  link: string | null;
  user_id: string;
  created_at: string;
  lat: number | null;
  lon: number | null;
  tags: string[] | null;
  collection: string | null;
  visited: boolean;
  personal_note: string | null;
  rating: number | null;
};

export type Collection = {
  id: string;
  name: string;
  user_id: string;
  created_at: string;
};

/* ── Helpers ── */

/**
 * Orders stops for display.
 *
 * `sort_order` is the source of truth. It used to sort by `time` instead, which
 * meant fetchStops' ORDER BY sort_order was discarded on every render and
 * drag-to-reorder silently did nothing. `time` is only a tiebreaker now, for
 * rows that share an index.
 *
 * Where a chronological list is wanted after someone edits a time, call
 * resequenceStopsByTime() — that persists the new sequence rather than
 * re-deriving a different order on each render.
 */
export function sortStops(stops: Stop[]): Stop[] {
  return [...stops].sort(
    (a, b) => a.sort_order - b.sort_order || a.time.localeCompare(b.time)
  );
}

/** Chronological order, without touching what is stored. */
export function sortStopsByTime(stops: Stop[]): Stop[] {
  return [...stops].sort((a, b) => a.time.localeCompare(b.time) || a.sort_order - b.sort_order);
}

/* ── Public queries (share link — no user_id filter) ── */

/*
 * Share-link reads.
 *
 * Direct table access is owner-scoped now, so a guest holding a share link
 * gets nothing back from a plain select. These helpers try the owner path
 * first and fall back to the get_shared_plan RPC, which requires the caller
 * to present the exact plan id. Guest pages therefore need no changes, and
 * the host continues to read their own rows through normal RLS.
 */
type SharedPlanPayload = { plan: Plan; stops: Stop[]; rsvps: Rsvp[] } | null;

async function fetchSharedPlanPayload(planId: string): Promise<SharedPlanPayload> {
  const { data, error } = await supabase.rpc('get_shared_plan', { p_plan_id: planId });
  if (error) throw error;
  return (data ?? null) as SharedPlanPayload;
}

export async function fetchPlan(id: string) {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (data) return data as Plan;

  const shared = await fetchSharedPlanPayload(id);
  return shared?.plan ?? null;
}

export async function fetchStops(planId: string) {
  const { data, error } = await supabase
    .from('stops')
    .select('*')
    .eq('plan_id', planId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  if (data && data.length > 0) return data as Stop[];

  // Empty can mean "no stops" or "RLS hid the rows". If we can see the plan
  // directly, empty is real — do not call the share RPC (that hung Events load).
  const { data: plan } = await supabase
    .from('plans')
    .select('id')
    .eq('id', planId)
    .maybeSingle();
  if (plan) return [];

  const shared = await fetchSharedPlanPayload(planId);
  return (shared?.stops ?? []) as Stop[];
}

export async function fetchRsvps(planId: string) {
  const { data, error } = await supabase
    .from('rsvps')
    .select('*')
    .eq('plan_id', planId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (data && data.length > 0) return data as Rsvp[];

  const { data: plan } = await supabase
    .from('plans')
    .select('id')
    .eq('id', planId)
    .maybeSingle();
  if (plan) return [];

  const shared = await fetchSharedPlanPayload(planId);
  return (shared?.rsvps ?? []) as Rsvp[];
}

export async function insertRsvp(
  rsvp: Omit<Rsvp, 'id' | 'created_at' | 'decline_reason' | 'user_id' | 'auth_uid'> & {
    decline_reason?: string | null;
    auth_uid?: string | null;
  }
) {
  // Guests no longer INSERT directly. The RPC validates the plan exists and is
  // not canceled, bounds the name, and constrains status server-side.
  const { data, error } = await supabase.rpc('submit_plan_rsvp', {
    p_plan_id: rsvp.plan_id,
    p_name: rsvp.name,
    p_status: rsvp.status,
    p_decline_reason: rsvp.decline_reason ?? null,
  });
  if (error) throw error;
  return data as Rsvp;
}

/* ── Creator queries (plans — filtered by anonymous user_id) ── */

export async function createPlan(
  plan: Omit<Plan, 'id' | 'created_at' | 'share_link' | 'canceled' | 'user_id' | 'trip_id' | 'day_number' | 'accommodation_name' | 'accommodation_address'> & {
    accommodation_name?: string | null;
    accommodation_address?: string | null;
    trip_id?: string | null;
    day_number?: number | null;
  }
) {
  const userId = getUserId();
  const ownerId = await getAuthUserId();
  if (ownerId && await remainingActivePlanSlots() < 1) {
    throw new Error('Free includes 1 active plan. Cancel it, or upgrade, before starting another.');
  }
  const { data, error } = await supabase
    .from('plans')
    // user_id is still written so an anonymous session keeps working; owner_id
    // is what actually carries ownership once the user has an account.
    .insert({ ...plan, user_id: userId, owner_id: ownerId })
    .select()
    .single();
  if (error) throw error;
  return data as Plan;
}

export async function createStops(
  planId: string,
  stops: Omit<Stop, 'id' | 'plan_id' | 'user_id'>[]
) {
  const userId = getUserId();
  const ownerId = await getAuthUserId();
  if (ownerId) {
    const max = getPlanLimits(await limitsTier(ownerId)).maxStopsPerPlan;
    const { count, error: countError } = await supabase
      .from('stops')
      .select('id', { count: 'exact', head: true })
      .eq('plan_id', planId);
    if (countError) throw countError;
    if ((count ?? 0) + stops.length > max) {
      throw new Error(
        max === 2
          ? 'Free includes 2 stops on a plan. Upgrade for up to 5.'
          : `A plan can have up to ${max} stops.`,
      );
    }
  }
  const rows = stops.map((s, i) => ({
    ...s,
    plan_id: planId,
    user_id: userId,
    sort_order: i,
  }));
  const { data, error } = await supabase.from('stops').insert(rows).select();
  if (error) throw error;
  return (data ?? []) as Stop[];
}

export async function fetchAllPlans() {
  const userId = getUserId();
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('user_id', userId)
    .eq('canceled', false)
    .order('date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Plan[];
}

/** One past outing, condensed for the discovery prompt. */
export type PlanHistoryEntry = {
  title: string;
  date: string;
  location: string | null;
  stops: { name: string; address: string; type: string }[];
};

/**
 * The user's recent plans with their stops — what they actually went out and
 * did, as opposed to what they saved. Feeds the "learns over time" behaviour
 * in discovery: suburbs they return to, how far they travel, which vibes they
 * favour. Read through RLS, so it is the caller's own plans on either key.
 */
export async function fetchRecentPlanHistory(limit = 12): Promise<PlanHistoryEntry[]> {
  const { data: plans, error } = await supabase
    .from('plans')
    .select('id, title, date, location, type')
    .eq('canceled', false)
    .is('trip_id', null)
    .order('date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (plans ?? []) as { id: string; title: string; date: string; location: string | null; type: string | null }[];
  if (rows.length === 0) return [];

  // stops has no type column. A curated plan records its vibes in plans.type
  // ("food,bar,dessert") in stop order, so the nth stop takes the nth vibe.
  const { data: stops, error: stopsError } = await supabase
    .from('stops')
    .select('plan_id, name, address')
    .in('plan_id', rows.map((p) => p.id))
    .order('sort_order', { ascending: true });
  if (stopsError) throw stopsError;

  const vibesByPlan = new Map(rows.map((p) => [p.id, (p.type ?? '').split(',').map((t) => t.trim()).filter(Boolean)]));
  const byPlan = new Map<string, PlanHistoryEntry['stops']>();
  for (const st of (stops ?? []) as { plan_id: string; name: string; address: string }[]) {
    const list = byPlan.get(st.plan_id) ?? [];
    const vibes = vibesByPlan.get(st.plan_id) ?? [];
    list.push({ name: st.name, address: st.address, type: vibes[list.length] ?? vibes[vibes.length - 1] ?? 'food' });
    byPlan.set(st.plan_id, list);
  }
  return rows.map((p) => ({
    title: p.title,
    date: p.date,
    location: p.location,
    stops: byPlan.get(p.id) ?? [],
  }));
}

export async function fetchCanceledPlans(): Promise<Plan[]> {
  const userId = getUserId();
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('user_id', userId)
    .eq('canceled', true)
    .order('date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Plan[];
}

export async function markPlanCanceled(id: string) {
  const userId = getUserId();
  const { error } = await supabase
    .from('plans')
    .update({ canceled: true })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function deletePlan(id: string) {
  const userId = getUserId();
  const { error } = await supabase
    .from('plans')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function updatePlan(
  id: string,
  updates: Partial<Pick<Plan, 'title' | 'date' | 'location' | 'type' | 'accommodation_name' | 'accommodation_address'>>
) {
  const userId = getUserId();
  const { data, error } = await supabase
    .from('plans')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  return data as Plan;
}

export async function replaceStops(
  planId: string,
  stops: Omit<Stop, 'id' | 'plan_id' | 'user_id'>[]
) {
  const userId = getUserId();
  const { error: delErr } = await supabase
    .from('stops')
    .delete()
    .eq('plan_id', planId)
    .eq('user_id', userId);
  if (delErr) throw delErr;
  return createStops(planId, stops);
}

export async function updateStop(
  id: string,
  updates: Partial<Pick<Stop, 'name' | 'address' | 'time' | 'sort_order'>>
) {
  const userId = getUserId();
  const { data, error } = await supabase
    .from('stops')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  return data as Stop;
}

export async function insertStop(
  planId: string,
  stop: Omit<Stop, 'id' | 'plan_id' | 'user_id'>
): Promise<Stop> {
  const userId = getUserId();
  const { data, error } = await supabase
    .from('stops')
    .insert({ ...stop, plan_id: planId, user_id: userId })
    .select()
    .single();
  if (error) throw error;
  return data as Stop;
}

export async function deleteStop(id: string): Promise<void> {
  const userId = getUserId();
  const { error } = await supabase
    .from('stops')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * Persists a new stop order in a single statement.
 *
 * This was a client-side loop issuing one awaited UPDATE per stop: N round
 * trips, and a failure partway left the order half-written with no rollback.
 * The RPC validates that every id belongs to the plan and applies the whole
 * ordering atomically.
 */
export async function reorderStops(
  planId: string,
  orderedStopIds: string[]
): Promise<void> {
  if (orderedStopIds.length === 0) return;
  const { error } = await supabase.rpc('reorder_plan_stops', {
    p_plan_id: planId,
    p_stop_ids: orderedStopIds,
  });
  if (error) throw error;
}

/**
 * Renumbers a plan's stops into chronological order and saves it.
 *
 * Called after a time edit so that what the user sees and what is stored agree
 * — previously the list re-sorted by time on screen while sort_order kept
 * whatever it had, and the two drifted apart permanently.
 */
export async function resequenceStopsByTime(planId: string, stops: Stop[]): Promise<Stop[]> {
  const ordered = sortStopsByTime(stops);
  const alreadyInOrder = ordered.every((s, i) => s.sort_order === i);
  if (!alreadyInOrder) {
    await reorderStops(planId, ordered.map((s) => s.id));
  }
  return ordered.map((s, i) => ({ ...s, sort_order: i }));
}

/* ── Trips (Travel Mode — multi-day itineraries) ── */

/**
 * Records a guest's decline reason.
 *
 * Guests cannot UPDATE rsvps directly — the only UPDATE policy requires owning
 * the parent plan. The RPC accepts a reason exactly once, onto a row that is
 * already declined.
 */
export async function setRsvpDeclineReason(rsvpId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('set_rsvp_decline_reason', {
    p_rsvp_id: rsvpId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function createTrip(
  trip: Omit<Trip, 'id' | 'created_at' | 'share_link' | 'is_paid' | 'user_id' | 'status'> & {
    status?: string;
    is_paid?: boolean;
  }
) {
  const userId = getUserId();
  const ownerId = await getAuthUserId();
  const { data, error } = await supabase
    .from('trips')
    .insert({
      ...trip,
      user_id: userId,
      owner_id: ownerId,
      status: trip.status ?? 'active',
      is_paid: trip.is_paid ?? false,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Trip;
}

type SharedTripPayload =
  { trip: Trip; days: Plan[]; stops: Stop[]; stop_rsvps: StopRsvp[] } | null;

async function fetchSharedTripPayload(tripId: string): Promise<SharedTripPayload> {
  const { data, error } = await supabase.rpc('get_shared_trip', { p_trip_id: tripId });
  if (error) throw error;
  return (data ?? null) as SharedTripPayload;
}

export async function fetchTrip(id: string): Promise<Trip | null> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (data) return data as Trip;

  const shared = await fetchSharedTripPayload(id);
  return shared?.trip ?? null;
}

export async function fetchAllTrips(): Promise<Trip[]> {
  const userId = getUserId();
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('start_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Trip[];
}

export async function fetchTripDays(tripId: string): Promise<Plan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('trip_id', tripId)
    .order('day_number', { ascending: true });
  if (error) throw error;
  if (data && data.length > 0) return data as Plan[];

  // Visible trip with no day rows yet — empty is real.
  const { data: trip } = await supabase
    .from('trips')
    .select('id')
    .eq('id', tripId)
    .maybeSingle();
  if (trip) return [];

  const shared = await fetchSharedTripPayload(tripId);
  return (shared?.days ?? []) as Plan[];
}

export async function updateTrip(
  id: string,
  updates: Partial<Pick<Trip, 'name' | 'destination' | 'start_date' | 'num_days' | 'status'>>
) {
  const userId = getUserId();
  const { data, error } = await supabase
    .from('trips')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  return data as Trip;
}

export async function deleteTrip(id: string): Promise<void> {
  const userId = getUserId();
  const { error } = await supabase
    .from('trips')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function cancelTrip(id: string): Promise<void> {
  const userId = getUserId();
  const { error } = await supabase
    .from('trips')
    .update({ status: 'canceled' })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

/* ── Per-stop RSVPs (Travel Mode) ── */

export async function fetchStopRsvps(tripId: string): Promise<StopRsvp[]> {
  const { data, error } = await supabase
    .from('stop_rsvps')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (data && data.length > 0) return data as StopRsvp[];

  const shared = await fetchSharedTripPayload(tripId);
  return (shared?.stop_rsvps ?? []) as StopRsvp[];
}

export async function fetchStopRsvpsByPlan(planId: string): Promise<StopRsvp[]> {
  const { data, error } = await supabase
    .from('stop_rsvps')
    .select('*')
    .eq('plan_id', planId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as StopRsvp[];
}

export async function insertStopRsvp(
  rsvp: Omit<StopRsvp, 'id' | 'created_at' | 'user_id' | 'auth_uid'> & {
    auth_uid?: string | null;
  }
) {
  // Direct INSERT is closed; the RPC resolves plan_id/trip_id from the stop
  // itself rather than trusting whatever the caller supplied.
  const { data, error } = await supabase.rpc('submit_stop_rsvp', {
    p_stop_id: rsvp.stop_id,
    p_name: rsvp.name,
    p_status: rsvp.status,
    p_guest_key: getGuestKey(),
  });
  if (error) throw error;
  return data as StopRsvp;
}

export async function upsertStopRsvp(
  stopId: string,
  planId: string,
  tripId: string | null,
  name: string,
  status: 'in' | 'out'
): Promise<StopRsvp> {
  // submit_stop_rsvp performs the update-or-insert in one server-side call.
  // The previous read-then-write could not work for guests once stop_rsvps
  // reads became owner-scoped, and was racy besides.
  void planId;
  void tripId;
  const { data, error } = await supabase.rpc('submit_stop_rsvp', {
    p_stop_id: stopId,
    p_name: name,
    p_status: status,
    p_guest_key: getGuestKey(),
  });
  if (error) throw error;
  return data as StopRsvp;
}

/* ── Saved venues (auth-scoped — RLS filters by auth.uid()) ── */

export async function fetchSavedVenues(limit?: number) {
  let query = supabase
    .from('saved_venues')
    .select('*')
    .order('created_at', { ascending: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as SavedVenue[];
}

export async function insertSavedVenue(
  venue: Omit<SavedVenue, 'id' | 'created_at' | 'user_id' | 'collection' | 'visited' | 'personal_note' | 'rating'> & { collection?: string | null; visited?: boolean; personal_note?: string | null; rating?: number | null }
) {
  const { data, error } = await supabase
    .from('saved_venues')
    .insert(venue)
    .select()
    .single();
  if (error) throw error;
  return data as SavedVenue;
}

export async function deleteSavedVenue(id: string) {
  const { error } = await supabase
    .from('saved_venues')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function updateSavedVenue(
  id: string,
  updates: Partial<Pick<SavedVenue, 'name' | 'address' | 'type' | 'tags' | 'collection' | 'visited' | 'personal_note' | 'rating'>>
) {
  const { data, error } = await supabase
    .from('saved_venues')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as SavedVenue;
}

export async function updateSavedVenueCoords(id: string, lat: number, lon: number): Promise<void> {
  const { error } = await supabase
    .from('saved_venues')
    .update({ lat, lon })
    .eq('id', id);
  if (error) throw error;
}

/* ── Collections (travel-mode trip folders) ── */

export async function fetchCollections(): Promise<Collection[]> {
  const { data, error } = await supabase
    .from('collections')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Collection[];
}

/* ── Shared collections ──
   A collection has one owner (collections.user_id) and any number of members.
   Members can read it and add their own venues; only the owner shares,
   renames, or deletes. Membership is managed by RPCs that check friendship. */

export type CollectionMember = {
  user_id: string;
  display_name: string | null;
  username: string | null;
  added_at: string;
};

/** A venue inside a collection, with who put it there. */
export type CollectionVenue = SavedVenue & {
  added_by: string | null;
  added_at: string;
};

/**
 * Every venue in a collection, including other members' — the one place a
 * member sees rows from someone else's saved_venues. fetchSavedVenues() stays
 * scoped to the caller's own venues.
 */
export async function fetchCollectionVenues(collectionId: string): Promise<CollectionVenue[]> {
  const { data, error } = await supabase.rpc('get_collection_venues', { p_collection_id: collectionId });
  if (error) throw error;
  return (data ?? []) as CollectionVenue[];
}

export async function fetchCollectionMembers(collectionId: string): Promise<CollectionMember[]> {
  const { data, error } = await supabase.rpc('get_collection_members', { p_collection_id: collectionId });
  if (error) throw error;
  return (data ?? []) as CollectionMember[];
}

/** Returns how many were actually added; non-friends are skipped server-side. */
export async function shareCollectionWithFriends(collectionId: string, userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const { data, error } = await supabase.rpc('share_collection_with_users', {
    p_collection_id: collectionId,
    p_user_ids: userIds,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function shareCollectionWithGroup(collectionId: string, groupId: string): Promise<number> {
  const { data, error } = await supabase.rpc('share_collection_with_group', {
    p_collection_id: collectionId,
    p_group_id: groupId,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

/** Owner removes a member, or a member removes themselves. */
export async function removeCollectionMember(collectionId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_collection_member', {
    p_collection_id: collectionId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function createCollection(name: string): Promise<Collection> {
  const { data, error } = await supabase
    .from('collections')
    .insert({ name })
    .select()
    .single();
  if (error) throw error;
  return data as Collection;
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('collections')
    .update({ name })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteCollection(id: string): Promise<void> {
  const { error } = await supabase
    .from('collections')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function addVenueToCollection(collectionId: string, venueId: string): Promise<void> {
  const { error } = await supabase
    .from('collection_venues')
    .insert({ collection_id: collectionId, venue_id: venueId });
  if (error && error.code !== '23505') throw error;
}

export async function removeVenueFromCollection(collectionId: string, venueId: string): Promise<void> {
  const { error } = await supabase
    .from('collection_venues')
    .delete()
    .eq('collection_id', collectionId)
    .eq('venue_id', venueId);
  if (error) throw error;
}

export async function fetchVenueCollectionIds(venueId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('collection_venues')
    .select('collection_id')
    .eq('venue_id', venueId);
  if (error) throw error;
  return (data ?? []).map((r) => r.collection_id as string);
}

export async function fetchCollectionVenueIds(collectionId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('collection_venues')
    .select('venue_id')
    .eq('collection_id', collectionId);
  if (error) throw error;
  return (data ?? []).map((r) => r.venue_id as string);
}

export async function fetchAllCollectionMemberships(): Promise<Record<string, string[]>> {
  const { data, error } = await supabase
    .from('collection_venues')
    .select('collection_id, venue_id');
  if (error) throw error;
  const map: Record<string, string[]> = {};
  for (const row of data ?? []) {
    const vid = row.venue_id as string;
    if (!map[vid]) map[vid] = [];
    map[vid].push(row.collection_id as string);
  }
  return map;
}

/* ── Guest name (for discovering confirmed plans without an account) ── */

const GUEST_NAME_KEY = 'onlyfinds_guest_name';

export function getGuestName(): string {
  return safeStorage.getItem(GUEST_NAME_KEY) ?? '';
}

export function setGuestName(name: string): void {
  safeStorage.setItem(GUEST_NAME_KEY, name);
}

/* ── Plans the current guest has confirmed (via RSVP with status 'in') ── */

export async function fetchConfirmedPlanIds(guestName: string): Promise<string[]> {
  if (!guestName.trim()) return [];
  const { data, error } = await supabase
    .from('rsvps')
    .select('plan_id')
    .eq('name', guestName.trim())
    .eq('status', 'in');
  if (error) throw error;
  return (data ?? []).map((r) => r.plan_id as string);
}

export async function fetchPlansByIds(ids: string[]): Promise<Plan[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .in('id', ids)
    .eq('canceled', false)
    .order('date', { ascending: true });
  if (error) throw error;
  const found = (data ?? []) as Plan[];

  // Plans you were invited to aren't yours, so the table hides them (only
  // owners can read plans). Read those through the share RPC instead: the
  // same view the invite link opens.
  const seen = new Set(found.map((p) => p.id));
  const shared = await Promise.all(
    ids
      .filter((id) => !seen.has(id))
      .map((id) => fetchSharedPlanPayload(id).then((s) => s?.plan ?? null).catch(() => null))
  );
  const invited = shared.filter((p): p is Plan => p !== null && !p.canceled);
  return [...found, ...invited].sort((a, b) => a.date.localeCompare(b.date));
}

/* ── Profiles ── */

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function upsertProfile(displayName: string, username?: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const payload: Record<string, string> = { id: session.user.id, display_name: displayName };
  if (username !== undefined) payload.username = username;
  const { error } = await supabase
    .from('profiles')
    .upsert(payload);
  if (error) throw error;
}

export async function completeOnboarding(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('profiles')
    .update({ onboarding_completed: true })
    .eq('id', session.user.id);
  if (error) throw error;
}

export async function resetOnboarding(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('profiles')
    .update({ onboarding_completed: false })
    .eq('id', session.user.id);
  if (error) throw error;
}

export async function updateDietaryPreferences(preferences: string[]): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('profiles')
    .update({ dietary_preferences: preferences.length > 0 ? preferences : null })
    .eq('id', session.user.id);
  if (error) throw error;
}

export async function checkUsernameAvailable(username: string): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  const taken = await searchUserByUsername(username);
  if (!taken) return true;
  return session?.user.id === taken.id;
}

export type PublicProfile = { id: string; display_name: string; username: string | null };

/**
 * profiles is readable only by its owner (it also holds billing and dietary
 * data), so other people are looked up through two functions that return
 * just id, display name and username. See 20260927090000_public_profile_lookup.
 */
export async function searchUserByUsername(query: string): Promise<PublicProfile | null> {
  const clean = query.trim().replace(/^@/, '');
  if (!clean) return null;
  const { data, error } = await supabase.rpc('find_profile_by_username', { p_username: clean });
  if (error) throw error;
  return ((data ?? []) as PublicProfile[])[0] ?? null;
}

/** Up to 10 people whose username or display name contains the text, best match first. */
export async function searchUsers(query: string): Promise<PublicProfile[]> {
  const clean = query.trim().replace(/^@/, '');
  if (!clean) return [];
  const { data, error } = await supabase.rpc('search_profiles', { p_query: clean });
  if (error) throw error;
  return (data ?? []) as PublicProfile[];
}

/** Names for friends, pending requests and group members; others are omitted. */
async function fetchPublicProfiles(ids: string[]): Promise<Map<string, PublicProfile>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.rpc('get_public_profiles', { p_ids: [...new Set(ids)] });
  if (error) throw error;
  return new Map(((data ?? []) as PublicProfile[]).map((p) => [p.id, p]));
}

// ── Friends ──

export type Friendship = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  updated_at: string;
};

export type FriendWithProfile = {
  friendship_id: string;
  user_id: string;
  display_name: string;
  username: string | null;
  status: 'pending' | 'accepted' | 'declined';
  direction: 'incoming' | 'outgoing';
  created_at: string;
};

export async function sendFriendRequest(targetUserId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('friendships')
    .insert({ requester_id: session.user.id, addressee_id: targetUserId, status: 'pending' });
  if (error) throw error;


  await sendPushNotification({
    userId: targetUserId,
    title: 'New friend request',
    body: 'Someone wants to be your friend',
    type: 'friend_request',
    data: { from_user_id: session.user.id },
  });
}

export async function acceptFriendRequest(friendshipId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('id', friendshipId)
    .select('requester_id')
    .single();
  if (error) throw error;

  const requesterId = (data as { requester_id: string }).requester_id;

  await sendPushNotification({
    userId: requesterId,
    title: 'Friend request accepted',
    body: 'You are now friends',
    type: 'friend_accepted',
    data: { from_user_id: session.user.id },
  });
}

export async function declineFriendRequest(friendshipId: string): Promise<void> {
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'declined' })
    .eq('id', friendshipId);
  if (error) throw error;
}

export async function removeFriend(friendshipId: string): Promise<void> {
  const { error } = await supabase
    .from('friendships')
    .delete()
    .eq('id', friendshipId);
  if (error) throw error;
}

export async function fetchFriends(): Promise<FriendWithProfile[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  const uid = session.user.id;
  const { data, error } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, status, created_at, updated_at')
    .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (!data) return [];

  const otherIds = (data as Friendship[]).map((f) =>
    f.requester_id === uid ? f.addressee_id : f.requester_id
  );
  if (otherIds.length === 0) return [];

  const profileMap = await fetchPublicProfiles(otherIds);

  return (data as Friendship[]).map((f) => {
    const otherId = f.requester_id === uid ? f.addressee_id : f.requester_id;
    const profile = profileMap.get(otherId) as { display_name: string; username: string | null } | undefined;
    return {
      friendship_id: f.id,
      user_id: otherId,
      display_name: profile?.display_name ?? 'Unknown',
      username: profile?.username ?? null,
      status: f.status,
      direction: f.requester_id === uid ? 'outgoing' : 'incoming',
      created_at: f.created_at,
    };
  });
}

// ── Friend Groups ──

export type FriendGroup = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
};

export type FriendGroupWithMembers = FriendGroup & {
  members: { user_id: string; display_name: string; username: string | null }[];
};

export async function createFriendGroup(name: string): Promise<FriendGroup> {
  const { data, error } = await supabase
    .from('friend_groups')
    .insert({ name })
    .select('id, name, owner_id, created_at')
    .single();
  if (error) throw error;
  return data as FriendGroup;
}

export async function fetchFriendGroups(): Promise<FriendGroupWithMembers[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  const uid = session.user.id;
  const { data: memberships, error: membershipError } = await supabase
    .from('friend_group_members')
    .select('group_id')
    .eq('user_id', uid);
  if (membershipError) throw membershipError;
  const memberGroupIds = (memberships ?? []).map((m) => m.group_id as string);
  const { data: ownedGroups, error: ownedError } = await supabase
    .from('friend_groups')
    .select('id, name, owner_id, created_at')
    .eq('owner_id', uid)
    .order('created_at', { ascending: false });
  if (ownedError) throw ownedError;
  const { data: memberGroups, error: memberError } = memberGroupIds.length > 0
    ? await supabase.from('friend_groups').select('id, name, owner_id, created_at').in('id', memberGroupIds)
    : { data: [], error: null };
  if (memberError) throw memberError;
  const groupMap = new Map<string, FriendGroup>();
  for (const group of [...(ownedGroups ?? []), ...(memberGroups ?? [])] as FriendGroup[]) groupMap.set(group.id, group);
  const groups = Array.from(groupMap.values());
  if (groups.length === 0) return [];

  const groupIds = groups.map((g) => g.id);
  const { data: members } = await supabase
    .from('friend_group_members')
    .select('group_id, user_id')
    .in('group_id', groupIds);

  const memberUserIds = [...new Set((members ?? []).map((m) => m.user_id))];
  const profileMap = await fetchPublicProfiles(memberUserIds);
  const membersByGroup = new Map<string, { user_id: string; display_name: string; username: string | null }[]>();
  for (const m of members ?? []) {
    const arr = membersByGroup.get(m.group_id) ?? [];
    const p = profileMap.get(m.user_id) as { display_name: string; username: string | null } | undefined;
    arr.push({ user_id: m.user_id, display_name: p?.display_name ?? 'Unknown', username: p?.username ?? null });
    membersByGroup.set(m.group_id, arr);
  }

  return (groups as FriendGroup[]).map((g) => ({
    ...g,
    members: membersByGroup.get(g.id) ?? [],
  }));
}

export async function addGroupMember(groupId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('friend_group_members')
    .insert({ group_id: groupId, user_id: userId });
  if (error) throw error;
}

export async function removeGroupMember(groupId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('friend_group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function deleteFriendGroup(groupId: string): Promise<void> {
  const { error } = await supabase
    .from('friend_groups')
    .delete()
    .eq('id', groupId);
  if (error) throw error;
}

// ── Shared Collections ──
// The former shared_collections / shared_collection_members /
// shared_collection_venues API lived here. Those tables held their own
// copy-pasted venue rows, disconnected from saved_venues, so a "shared
// collection" could never contain anything the user had actually saved. The
// tables remain in the database (nothing is dropped) but the app no longer
// reads or writes them; sharing is now a property of the real collections —
// see fetchCollectionVenues / shareCollectionWithFriends above.

// ── Plan Invites ──

export async function inviteUserToPlan(planId: string, userId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('plan_invites')
    .insert({ plan_id: planId, invited_user_id: userId, invited_by: session.user.id });
  if (error) throw error;


  await sendPushNotification({
    userId,
    title: 'New event invite',
    body: 'You have been invited to an event',
    type: 'plan_invite',
    data: { plan_id: planId, from_user_id: session.user.id, url: `/#/plan/${planId}` },
  });
}

export async function inviteGroupToPlan(planId: string, groupId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('plan_invites')
    .insert({ plan_id: planId, group_id: groupId, invited_by: session.user.id });
  if (error) throw error;

  const { data: members } = await supabase
    .from('friend_group_members')
    .select('user_id')
    .eq('group_id', groupId);

  const memberIds = (members ?? []).map((m) => m.user_id);

  if (memberIds.length > 0) {
    await sendPushNotificationToMany({
      userIds: memberIds,
      title: 'New event invite',
      body: 'Your group has been invited to an event',
      type: 'plan_invite',
      data: { plan_id: planId, from_user_id: session.user.id, url: `/#/plan/${planId}` },
    });
  }
}

export async function fetchInvitedPlanIds(): Promise<string[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  const uid = session.user.id;
  const { data: memberships } = await supabase
    .from('friend_group_members')
    .select('group_id')
    .eq('user_id', uid);
  // PostgREST `in.()` with an empty list can hang or error — always pass a sentinel.
  const groupIds = (memberships ?? []).map((m) => m.group_id as string);
  const groupFilter = groupIds.length > 0 ? groupIds : ['00000000-0000-0000-0000-000000000000'];

  const [userInvites, groupInvites] = await Promise.all([
    supabase.from('plan_invites').select('plan_id').eq('invited_user_id', uid),
    supabase
      .from('plan_invites')
      .select('plan_id, group_id')
      .not('group_id', 'is', null)
      .in('group_id', groupFilter),
  ]);

  const ids = new Set<string>();
  for (const r of userInvites.data ?? []) ids.add(r.plan_id);
  for (const r of (groupInvites.data as { plan_id: string }[]) ?? []) ids.add(r.plan_id);
  return Array.from(ids);
}

export async function fetchInvitedUserIdsForPlan(planId: string): Promise<Set<string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return new Set();
  const { data, error } = await supabase
    .from('plan_invites')
    .select('invited_user_id, group_id')
    .eq('plan_id', planId);
  if (error) return new Set();

  const ids = new Set<string>();
  for (const row of data ?? []) {
    if (row.invited_user_id) ids.add(row.invited_user_id);
    if (row.group_id) {
      const { data: members } = await supabase
        .from('friend_group_members')
        .select('user_id')
        .eq('group_id', row.group_id);
      for (const m of members ?? []) ids.add(m.user_id);
    }
  }
  return ids;
}

// ── Notifications ──

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
};

export async function fetchNotifications(): Promise<NotificationItem[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data as NotificationItem[]) ?? [];
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id);
  if (error) throw error;
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('read', false);
  if (error) throw error;
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('read', false);
  if (error) throw error;
  return count ?? 0;
}

// ── Push Subscriptions ──

export async function savePushSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  const { error } = await supabase
    .from('push_subscriptions')
    .insert({
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh ?? '',
      auth_key: json.keys?.auth ?? '',
    });
  if (error) throw error;
}

export async function subscribeToPush(): Promise<PushSubscription | null> {
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!publicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) return null;

  // iOS requires the app to be installed to home screen before push works
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (isIOS && !isStandalone) {
    showIOSHomeScreenPrompt();
    return null;
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub) return sub;

  sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await savePushSubscription(sub);
  return sub;
}

function showIOSHomeScreenPrompt(): void {
  const existing = document.getElementById('ios-a2hs-prompt');
  if (existing) return;

  const banner = document.createElement('div');
  banner.id = 'ios-a2hs-prompt';
  banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;padding:16px 20px;background:#0d0d0d;border-top:1px solid rgba(212,175,55,0.3);color:#f5f5f0;font-family:system-ui,sans-serif;font-size:14px;display:flex;align-items:center;gap:12px;';

  const icon = document.createElement('div');
  icon.style.cssText = 'flex-shrink:0;width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#d4af37,#b8941f);display:flex;align-items:center;justify-content:center;font-size:22px;';
  icon.textContent = '+';

  const text = document.createElement('div');
  text.style.cssText = 'flex:1;';
  text.innerHTML = '<div style="font-weight:600;margin-bottom:2px;">Add to Home Screen</div><div style="opacity:0.7;font-size:12px;">Tap the Share button, then "Add to Home Screen" to enable lock-screen notifications.</div>';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = 'flex-shrink:0;background:none;border:none;color:#f5f5f0;font-size:24px;cursor:pointer;padding:0 4px;line-height:1;';
  closeBtn.onclick = () => banner.remove();

  banner.appendChild(icon);
  banner.appendChild(text);
  banner.appendChild(closeBtn);
  document.body.appendChild(banner);

  setTimeout(() => banner.remove(), 15000);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i);
  return output;
}

// ── Send Push Notification (edge function) ──

/**
 * Writes the in-app notification (server-side, since a user may not insert
 * rows for someone else) and then tries a web push. Callers should not also
 * insert into notifications themselves: RLS refuses it with a 403.
 */
export async function sendPushNotification(params: {
  userId: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  type?: string;
}): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  try {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push-notification`;
    await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        user_id: params.userId,
        title: params.title,
        body: params.body,
        data: params.data,
        type: params.type,
      }),
    });
  } catch {
    // Push is best-effort — don't block the user flow on failures
  }
}

export async function sendPushNotificationToMany(params: {
  userIds: string[];
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  type?: string;
}): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  try {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push-notification`;
    await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        user_ids: params.userIds,
        title: params.title,
        body: params.body,
        data: params.data,
        type: params.type,
      }),
    });
  } catch {
    // Push is best-effort
  }
}

// Guest RSVP push — no auth session, uses plan_id to find host
export async function sendGuestRsvpPushNotification(params: {
  planId: string;
  rsvpName: string;
  rsvpStatus: string;
}): Promise<void> {
  try {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push-notification`;
    await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        // The gateway's verify_jwt wants a bearer token even for guests. The
        // anon key is a valid JWT; the function's guest branch then verifies
        // the RSVP itself rather than trusting the caller.
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        plan_id: params.planId,
        rsvp_name: params.rsvpName,
        rsvp_status: params.rsvpStatus,
      }),
    });
  } catch {
    // Push is best-effort
  }
}

/* ── Venue Partners (sponsored venue client portal) ── */

export type VenuePartner = {
  id: string;
  /** Null for venues staff added before the business had an account. */
  owner_id: string | null;
  business_name: string;
  address: string;
  type: VenueType;
  instagram_link: string | null;
  website: string | null;
  contact_name: string;
  contact_email: string;
  monthly_budget_cents: number | null;
  visit_rate_cents: number;
  active: boolean;
  approved: boolean;
  stripe_customer_id: string | null;
  lat: number | null;
  lon: number | null;
  created_at: string;
};

/* ── Admin: venue partners and the team (staff and admins only) ──
   The server checks the role on every call; these only shape the data. */

/** A venue partner as the admin page sees it, with its numbers. */
export type AdminPartner = {
  id: string;
  business_name: string;
  address: string;
  type: VenueType;
  contact_name: string;
  contact_email: string;
  instagram_link: string | null;
  website: string | null;
  monthly_budget_cents: number | null;
  visit_rate_cents: number;
  active: boolean;
  approved: boolean;
  /** The business has its own account and portal. */
  has_account: boolean;
  created_at: string;
  impressions: number;
  saves: number;
  visits: number;
  month_visits: number;
  /** Visits this month x rate, never more than the monthly budget. */
  month_billed_cents: number;
  total_billed_cents: number;
};

export type AdminPartnerInput = {
  business_name: string;
  address: string;
  type: VenueType;
  contact_name: string;
  contact_email: string;
  instagram_link: string | null;
  website: string | null;
  monthly_budget_cents: number | null;
  /** Admins only; the server ignores these from staff. */
  visit_rate_cents?: number;
  approved?: boolean;
};

export type TeamMember = {
  id: string;
  display_name: string | null;
  username: string | null;
  email: string;
  role: AppRole;
};

export async function fetchAdminPartners(): Promise<AdminPartner[]> {
  const { data, error } = await supabase.rpc('admin_partner_overview');
  if (error) throw error;
  return ((data ?? []) as AdminPartner[]).map((p) => ({
    ...p,
    impressions: Number(p.impressions),
    saves: Number(p.saves),
    visits: Number(p.visits),
    month_visits: Number(p.month_visits),
    month_billed_cents: Number(p.month_billed_cents),
    total_billed_cents: Number(p.total_billed_cents),
  }));
}

export async function adminCreatePartner(input: AdminPartnerInput): Promise<void> {
  const { error } = await supabase.from('venue_partners').insert({ ...input, owner_id: null });
  if (error) throw error;
}

export async function adminUpdatePartner(
  id: string,
  updates: Partial<AdminPartnerInput> & { active?: boolean },
): Promise<void> {
  const { error } = await supabase.from('venue_partners').update(updates).eq('id', id);
  if (error) throw error;
}

export async function adminDeletePartner(id: string): Promise<void> {
  const { error } = await supabase.from('venue_partners').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchTeam(): Promise<TeamMember[]> {
  const { data, error } = await supabase.rpc('admin_team');
  if (error) throw error;
  return (data ?? []) as TeamMember[];
}

/** Gives the account with this email a role; 'user' takes access away. */
export async function setTeamRole(email: string, role: AppRole): Promise<void> {
  const { error } = await supabase.rpc('admin_set_role', { p_email: email, p_role: role });
  if (error) throw new Error(error.message);
}

export type VenueEventType = 'impression' | 'saved' | 'visited';

export type VenueEvent = {
  id: string;
  venue_id: string;
  event_type: VenueEventType;
  plan_id: string | null;
  user_id: string | null;
  auth_uid: string | null;
  created_at: string;
};

export type VenueMilestone = {
  id: string;
  venue_id: string;
  milestone_type: 'visits' | 'impressions' | 'saves';
  threshold: number;
  reached_at: string;
  notified: boolean;
  created_at: string;
};

export type VenueRatingSummary = {
  venue_id: string;
  rating_count: number;
  average_rating: number;
};

export async function fetchVenuePartner(): Promise<VenuePartner | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from('venue_partners')
    .select('*')
    .eq('owner_id', session.user.id)
    .maybeSingle();
  if (error) throw error;
  return data as VenuePartner | null;
}

export async function createVenuePartner(
  partner: Omit<VenuePartner, 'id' | 'owner_id' | 'created_at' | 'approved' | 'active' | 'visit_rate_cents' | 'stripe_customer_id' | 'lat' | 'lon'> & {
    visit_rate_cents?: number;
    lat?: number | null;
    lon?: number | null;
  }
): Promise<VenuePartner> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('venue_partners')
    .insert({
      owner_id: session.user.id,
      business_name: partner.business_name,
      address: partner.address,
      type: partner.type,
      instagram_link: partner.instagram_link ?? null,
      website: partner.website ?? null,
      contact_name: partner.contact_name,
      contact_email: partner.contact_email,
      monthly_budget_cents: partner.monthly_budget_cents ?? null,
      visit_rate_cents: partner.visit_rate_cents ?? 50,
      lat: partner.lat ?? null,
      lon: partner.lon ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  await supabase.from('profiles').update({ is_venue_partner: true }).eq('id', session.user.id);
  return data as VenuePartner;
}

export async function updateVenuePartner(
  id: string,
  updates: Partial<Pick<VenuePartner, 'business_name' | 'address' | 'type' | 'instagram_link' | 'website' | 'contact_name' | 'contact_email' | 'monthly_budget_cents' | 'visit_rate_cents' | 'active' | 'lat' | 'lon'>>
): Promise<VenuePartner> {
  const { data, error } = await supabase
    .from('venue_partners')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as VenuePartner;
}

export async function fetchVenueEvents(venueId: string): Promise<VenueEvent[]> {
  const { data, error } = await supabase
    .from('venue_events')
    .select('*')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as VenueEvent[];
}

export async function recordVenueEvent(
  venueId: string,
  eventType: VenueEventType,
  planId?: string | null
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const { error } = await supabase
    .from('venue_events')
    .insert({
      venue_id: venueId,
      event_type: eventType,
      plan_id: planId ?? null,
      auth_uid: session?.user.id ?? null,
      user_id: session?.user.id ?? null,
    });
  if (error) throw error;
}

export async function fetchVenueMilestones(venueId: string): Promise<VenueMilestone[]> {
  const { data, error } = await supabase
    .from('venue_milestones')
    .select('*')
    .eq('venue_id', venueId)
    .order('threshold', { ascending: true });
  if (error) throw error;
  return (data ?? []) as VenueMilestone[];
}

export type VenueEventStats = {
  impressions: number;
  saves: number;
  visits: number;
  thisMonthVisits: number;
  thisMonthSpendCents: number;
};

export async function fetchVenueEventStats(venueId: string, visitRateCents: number): Promise<VenueEventStats> {
  // Aggregated server-side. The old client-side version summed at most 500
  // fetched rows, so any busy venue under-reported — and spend was computed
  // in the browser from that truncated set.
  void visitRateCents;
  const { data, error } = await supabase.rpc('get_venue_event_stats', { p_venue_id: venueId });
  if (error) throw error;
  const d = (data ?? {}) as Partial<VenueEventStats>;
  return {
    impressions: d.impressions ?? 0,
    saves: d.saves ?? 0,
    visits: d.visits ?? 0,
    thisMonthVisits: d.thisMonthVisits ?? 0,
    thisMonthSpendCents: d.thisMonthSpendCents ?? 0,
  };
}

/* ── Venue Ratings (public community) ── */

export async function fetchVenueRatingSummary(venueId: string): Promise<VenueRatingSummary | null> {
  const { data, error } = await supabase
    .from('venue_rating_summary')
    .select('*')
    .eq('venue_id', venueId)
    .maybeSingle();
  if (error) throw error;
  return data as VenueRatingSummary | null;
}

export async function fetchVenueRatingSummaries(venueIds: string[]): Promise<Record<string, VenueRatingSummary>> {
  if (venueIds.length === 0) return {};
  const { data, error } = await supabase
    .from('venue_rating_summary')
    .select('*')
    .in('venue_id', venueIds);
  if (error) throw error;
  const map: Record<string, VenueRatingSummary> = {};
  for (const row of (data ?? []) as VenueRatingSummary[]) {
    map[row.venue_id] = row;
  }
  return map;
}

export async function fetchUserVenueRating(venueId: string): Promise<number | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from('venue_ratings')
    .select('rating')
    .eq('venue_id', venueId)
    .eq('user_id', session.user.id)
    .maybeSingle();
  if (error) throw error;
  return (data as { rating: number } | null)?.rating ?? null;
}

export async function upsertVenueRating(venueId: string, rating: number): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('venue_ratings')
    .upsert({
      venue_id: venueId,
      user_id: session.user.id,
      rating,
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;
}

/* ── Subscription helpers ── */

export const SUBSCRIPTION_PLANS = {
  free: { label: 'Free', priceCents: 0, maxPlans: 1, maxStopsPerPlan: 2, ads: true },
  premium_monthly: { label: 'Premium', priceCents: 299, maxPlans: Infinity, maxStopsPerPlan: 5, ads: false },
  premium_yearly: { label: 'Premium Yearly', priceCents: 2499, maxPlans: Infinity, maxStopsPerPlan: 5, ads: false },
  lifetime: { label: 'Lifetime', priceCents: 3999, maxPlans: Infinity, maxStopsPerPlan: 5, ads: false },
} as const;

/** Premium features (trips) are open on any paid tier, and to everyone while testing is unlocked. */
export function hasPremium(tier: SubscriptionTier, premiumUnlocked: boolean): boolean {
  return premiumUnlocked || tier !== 'free';
}

export function getPlanLimits(tier: SubscriptionTier) {
  return SUBSCRIPTION_PLANS[tier] ?? SUBSCRIPTION_PLANS.free;
}

/**
 * Open testing: while app_settings.premium_unlocked is on, everyone gets
 * Premium limits without paying. The database enforces the same switch;
 * this only keeps the app's own checks and prompts in step with it.
 */
export async function fetchPremiumUnlocked(): Promise<boolean> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'premium_unlocked')
    .maybeSingle();
  return data?.value === true;
}

/** The tier whose limits apply to this account right now. */
async function limitsTier(ownerId: string): Promise<SubscriptionTier> {
  const [unlocked, { data }] = await Promise.all([
    fetchPremiumUnlocked(),
    supabase.from('profiles').select('subscription_tier').eq('id', ownerId).maybeSingle(),
  ]);
  if (unlocked) return 'premium_monthly';
  return (data?.subscription_tier ?? 'free') as SubscriptionTier;
}

/** How many more active (today or later, not canceled) plans this account can start. */
export async function remainingActivePlanSlots(): Promise<number> {
  const ownerId = await getAuthUserId();
  if (!ownerId) return Infinity;
  const max = getPlanLimits(await limitsTier(ownerId)).maxPlans;
  if (!Number.isFinite(max)) return Infinity;
  const today = new Date().toLocaleDateString('en-CA');
  const { count, error } = await supabase
    .from('plans')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    .eq('canceled', false)
    .gte('date', today);
  if (error) throw error;
  return Math.max(0, max - (count ?? 0));
}

/**
 * Billing runs through Stripe, rendered inside the app: checkout is Stripe's
 * embedded form, and plan changes go through the stripe-billing function.
 * The tier itself only changes when stripe-webhook hears back from Stripe.
 */
async function callBilling<T>(fn: 'stripe-checkout' | 'stripe-billing', body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Please sign in first.');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Billing is unavailable (${res.status})`);
  return data;
}

/** Client secret for the in-app (custom UI) checkout form. */
export async function startCheckout(tier: Exclude<SubscriptionTier, 'free'>): Promise<string> {
  const { clientSecret } = await callBilling<{ clientSecret: string }>('stripe-checkout', { tier, ui: 'custom' });
  return clientSecret;
}

export type BillingSummary = {
  subscription: {
    tier: SubscriptionTier | null;
    status: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string;
    amount: number | null;
    currency: string;
    interval: string | null;
  } | null;
  card: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  invoices: {
    id: string;
    date: string;
    amount: number;
    currency: string;
    status: string | null;
    description: string;
    pdf: string | null;
  }[];
};

export function fetchBilling(): Promise<BillingSummary> {
  return callBilling('stripe-billing', { action: 'summary' });
}

export function setCancelAtPeriodEnd(cancel: boolean): Promise<BillingSummary> {
  return callBilling('stripe-billing', { action: cancel ? 'cancel' : 'resume' });
}

export function switchSubscriptionPlan(tier: 'premium_monthly' | 'premium_yearly'): Promise<BillingSummary> {
  return callBilling('stripe-billing', { action: 'switch', tier });
}

/** Client secret for the in-app card form (a Stripe SetupIntent). */
export async function startCardUpdate(): Promise<string> {
  const { clientSecret } = await callBilling<{ clientSecret: string }>('stripe-billing', { action: 'card-setup' });
  return clientSecret;
}

export function saveCard(setupIntentId: string): Promise<BillingSummary> {
  return callBilling('stripe-billing', { action: 'card-save', setupIntentId });
}
