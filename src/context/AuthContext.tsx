import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, fetchProfile, type SubscriptionTier } from '../lib/supabase';

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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user.id) {
        loadProfile(data.session.user.id);
      } else {
        setProfileLoaded(true);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => {
      setSession(s);
      setProfileLoaded(false);
      (async () => {
        if (s?.user.id) {
          await loadProfile(s.user.id);
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
