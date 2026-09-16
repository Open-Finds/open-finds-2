import { supabase } from './supabase';

/**
 * Headers for calling an edge function that requires a signed-in user.
 *
 * The anon key used to be sent as the bearer token, but it ships inside the
 * JavaScript bundle — anyone could read it and call the paid endpoints
 * (OpenRouter, Google Maps) on our account. Those functions now require a real
 * user session, so the caller must present the session access token. The
 * `apikey` header is still sent because Supabase's gateway expects it.
 */
export async function edgeAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Please sign in to use this feature.');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  };
}
