import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, fetchProfile, claimDeviceRows, type SubscriptionTier } from '../lib/supabase';
import { setMonitoringUser } from '../lib/monitoring';

type AuthContextType = {
  session: Session | null;
  loading: boolean;
  profileLoaded: boolean;
  displayName: string | null;
  username: string | null;
  onboardingCompleted: boolean;
  dietaryPreferences: string[];
  subscriptionTier: SubscriptionTier;
  isVenuePartner: boolean;
  refreshProfile: () => Promise<void>;
  setOnboardingCompleted: (v: boolean) => void;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  loading: true,
  profileLoaded: false,
  displayName: null,
  username: null,
  onboardingCompleted: false,
  dietaryPreferences: [],
  subscriptionTier: 'free',
  isVenuePartner: false,
  refreshProfile: async () => {},
  setOnboardingCompleted: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [onboardingCompleted, setOnboardingCompletedState] = useState(false);
  const [dietaryPreferences, setDietaryPreferences] = useState<string[]>([]);
  const [subscriptionTier, setSubscriptionTier] = useState<SubscriptionTier>('free');
  const [isVenuePartner, setIsVenuePartner] = useState(false);

  const loadProfile = async (userId: string) => {
    try {
      const profile = await fetchProfile(userId);
      setDisplayName(profile?.display_name || null);
      setUsername(profile?.username || null);
      setOnboardingCompletedState(profile?.onboarding_completed ?? false);
      setDietaryPreferences(profile?.dietary_preferences ?? []);
      setSubscriptionTier(profile?.subscription_tier ?? 'free');
      setIsVenuePartner(profile?.is_venue_partner ?? false);
    } catch {
      setOnboardingCompletedState(false);
      setDietaryPreferences([]);
      setSubscriptionTier('free');
      setIsVenuePartner(false);
    } finally {
      setProfileLoaded(true);
    }
  };

  const refreshProfile = async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (s?.user.id) await loadProfile(s.user.id);
  };

  /**
   * Adopt this device's plans and trips into the account.
   *
   * Runs on every resolved session rather than only on sign-in, so a user who
   * installed the app anonymously, created plans, and later signed in on the
   * same browser keeps that work. The RPC only touches rows with no owner and
   * is idempotent, so calling it more than once costs nothing.
   */
  const claimForSession = async () => {
    try {
      await claimDeviceRows();
    } catch { /* non-fatal — device-scoped access still works */ }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setMonitoringUser(data.session?.user.id ?? null);
      if (data.session?.user.id) {
        loadProfile(data.session.user.id);
        claimForSession();
      } else {
        setProfileLoaded(true);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => {
      setSession(s);
      setMonitoringUser(s?.user.id ?? null);
      setProfileLoaded(false);
      (async () => {
        if (s?.user.id) {
          await loadProfile(s.user.id);
          await claimForSession();
        } else {
          setDisplayName(null);
          setUsername(null);
          setOnboardingCompletedState(false);
          setDietaryPreferences([]);
          setSubscriptionTier('free');
          setIsVenuePartner(false);
          setProfileLoaded(true);
        }
      })();
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading, profileLoaded, displayName, username, onboardingCompleted, dietaryPreferences, subscriptionTier, isVenuePartner, refreshProfile, setOnboardingCompleted: setOnboardingCompletedState }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
