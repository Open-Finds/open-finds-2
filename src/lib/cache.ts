import { useCallback, useState, type SetStateAction } from 'react';

/**
 * Screen data kept between visits, so coming back to a tab shows what it had
 * straight away while the fresh copy loads, instead of "Loading…" every time.
 *
 * It lives in memory only, and belongs to one account: signing in as someone
 * else, or out, empties it.
 */
const store = new Map<string, unknown>();
let owner: string | null = null;

/** Called whenever the signed-in account changes. */
export function setCacheOwner(userId: string | null) {
  if (userId === owner) return;
  store.clear();
  owner = userId;
}

/** Whether this screen has been loaded before, i.e. can skip "Loading…". */
export function hasCached(key: string): boolean {
  return store.has(key);
}

/**
 * useState that remembers its value for next time. Every update (a fresh
 * load, or an edit the screen makes itself) is kept, so the copy shown on
 * the next visit is never older than what the user last saw.
 */
export function useCachedState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initial));
  const set = useCallback((next: SetStateAction<T>) => {
    setValue((prev) => {
      const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      store.set(key, v);
      return v;
    });
  }, [key]);
  return [value, set] as const;
}
