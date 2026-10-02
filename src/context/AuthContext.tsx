import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, fetchProfile, fetchPremiumUnlocked, claimDeviceRows, arrivedFromPasswordReset, type SubscriptionTier } from '../lib/supabase';
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
  /** Stripe's view: active, trialing, past_due, or canceling (ends at renewsAt). */
  subscriptionStatus: string;
  subscriptionRenewsAt: string | null;
  /** Open testing: everyone has Premium limits, whatever their tier. */
  premiumUnlocked: boolean;
  isVenuePartner: boolean;
  /** Signed in from a password-reset email: ask for a new password first. */
  passwordRecovery: boolean;
  endPasswordRecovery: () => void;
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
  subscriptionStatus: 'active',
  subscriptionRenewsAt: null,
  premiumUnlocked: false,
  isVenuePartner: false,
  passwordRecovery: false,
  endPasswordRecovery: () => {},
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
  const [subscriptionStatus, setSubscriptionStatus] = useState('active');
  const [subscriptionRenewsAt, setSubscriptionRenewsAt] = useState<string | null>(null);
  const [premiumUnlocked, setPremiumUnlocked] = useState(false);
  const [isVenuePartner, setIsVenuePartner] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(arrivedFromPasswordReset);

  const loadProfile = async (userId: string) => {
    try {
      const profile = await fetchProfile(userId);
      setDisplayName(profile?.display_name || null);
      setUsername(profile?.username || null);
      setOnboardingCompletedState(profile?.onboarding_completed ?? false);
      setDietaryPreferences(profile?.dietary_preferences ?? []);
      setSubscriptionTier(profile?.subscription_tier ?? 'free');
      setSubscriptionStatus(profile?.subscription_status ?? 'active');
      setSubscriptionRenewsAt(profile?.subscription_renews_at ?? null);
      setPremiumUnlocked(await fetchPremiumUnlocked().catch(() => false));
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
      // A reset link that didn't sign anyone in (expired, used) asks nothing.
      if (!data.session) setPasswordRecovery(false);
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (event === 'SIGNED_OUT') setPasswordRecovery(false);
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
    <AuthContext.Provider value={{ session, loading, profileLoaded, displayName, username, onboardingCompleted, dietaryPreferences, subscriptionTier, subscriptionStatus, subscriptionRenewsAt, premiumUnlocked, isVenuePartner, passwordRecovery, endPasswordRecovery: () => setPasswordRecovery(false), refreshProfile, setOnboardingCompleted: setOnboardingCompletedState }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
