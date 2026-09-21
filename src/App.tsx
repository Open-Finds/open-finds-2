import { useState, useEffect, useCallback } from 'react';
import { useRouter, navigate } from './lib/router';
import { AuthProvider, useAuth } from './context/AuthContext';
import { HomePage } from './pages/Home';
import { EventsPage } from './pages/Events';
import { DashboardPage } from './pages/Dashboard';
import { VenuesPage } from './pages/Venues';
import { LoginPage } from './pages/Login';
import { SettingsPage } from './pages/Settings';
import { RsvpPage } from './pages/Rsvp';
import { ConfirmedPage } from './pages/Confirmed';
import { DeclinedPage } from './pages/Declined';
import { SharePage } from './pages/PlanView';
import { FriendsPage } from './pages/Friends';
import { NotificationsPage } from './pages/Notifications';
import { TripSetupPage } from './pages/TripSetup';
import { TripOverviewPage } from './pages/TripOverview';
import { TripRsvpPage } from './pages/TripRsvp';
import { TripDayPage } from './pages/TripDay';
import { VenuePortalPage } from './pages/VenuePortal';
import { SubscriptionPage } from './pages/Subscription';
import { ViewToggle } from './components/ViewToggle';
import { Onboarding } from './components/Onboarding';
import { fetchUnreadNotificationCount, subscribeToPush, completeOnboarding } from './lib/supabase';
import { Bell } from 'lucide-react';

type View = 'home' | 'events' | 'venues' | 'friends' | 'settings';

/**
 * Authenticated chrome. The content column clears the mobile tab bar via
 * padding-bottom and the desktop sidebar via padding-left (see .app-main),
 * so pages themselves stay layout-agnostic.
 */
function Shell({
  children,
  view,
  onChangeView,
  unreadCount,
  onOpenNotifications,
  isEditingItinerary = false,
}: {
  children: React.ReactNode;
  view: View;
  onChangeView: (v: View) => void;
  unreadCount: number;
  onOpenNotifications: () => void;
  isEditingItinerary?: boolean;
}) {
  return (
    <>
      <div className="app-main">
        <div className="app-canvas">{children}</div>
      </div>

      <button
        onClick={onOpenNotifications}
        className="fixed right-4 top-4 z-50 flex size-11 items-center justify-center rounded-full border border-gold/20 bg-[#0d0d0d]/90 text-gold backdrop-blur-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-90 sm:right-5 sm:top-5"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-black">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <ViewToggle view={view} onChange={onChangeView} isEditingItinerary={isEditingItinerary} />
    </>
  );
}

function AppInner() {
  const { route } = useRouter();
  const { session, loading: authLoading } = useAuth();
  const [view, setView] = useState<View>('home');
  const [dashboardId, setDashboardId] = useState<string | null>(null);
  const [editPlanId, setEditPlanId] = useState<string | null>(null);
  const [slideDir, setSlideDir] = useState<'left' | 'right'>('right');
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { onboardingCompleted, setOnboardingCompleted, profileLoaded } = useAuth();

  useEffect(() => {
    if (route.name === 'dashboard' && route.id) {
      setDashboardId(route.id);
    } else if (route.name === 'home') {
      setDashboardId(null);
    } else if (route.name === 'venues') {
      // Deep link (e.g. from a shared-collection notification). The Venues
      // page reads any ?collection= param itself.
      setDashboardId(null);
      setEditPlanId(null);
      setView('venues');
    }
  }, [route]);

  // Fetch unread notification count
  const refreshUnread = useCallback(async () => {
    if (!session) return;
    try {
      setUnreadCount(await fetchUnreadNotificationCount());
    } catch { /* ignore */ }
  }, [session]);

  useEffect(() => {
    refreshUnread();
    const interval = setInterval(refreshUnread, 30000);
    return () => clearInterval(interval);
  }, [refreshUnread]);

  // Register service worker and subscribe to push on login
  useEffect(() => {
    if (!session) return;
    (async () => {
      if ('serviceWorker' in navigator) {
        try {
          await navigator.serviceWorker.register('/sw.js');
          await subscribeToPush();
        } catch { /* ignore */ }
      }
    })();
  }, [session]);

  // Guest-facing routes — render standalone, no auth required
  if (route.name === 'rsvp') return <RsvpPage id={route.id} />;
  if (route.name === 'confirmed') return <ConfirmedPage id={route.id} />;
  if (route.name === 'declined') return <DeclinedPage id={route.id} />;
  if (route.name === 'share') return <SharePage id={route.id} />;
  if (route.name === 'trip-rsvp') return <TripRsvpPage tripId={route.id} />;

  // Trip routes — accessible without auth (share links)
  if (route.name === 'trip') return <TripOverviewPage tripId={route.id} />;
  if (route.name === 'trip-day') return <TripDayPage tripId={route.tripId} dayId={route.dayId} />;
  if (route.name === 'trip-setup') return <TripSetupPage />;

  // Venue partner portal + subscription — require auth
  if (route.name === 'venue-portal') {
    if (!session) return <LoginPage />;
    return <VenuePortalPage onBack={() => navigate('/')} />;
  }
  if (route.name === 'subscription') {
    if (!session) return <LoginPage />;
    return <SubscriptionPage onBack={() => navigate('/')} />;
  }

  // Blank screen while session loads — avoids flash of login page for returning users
  if (authLoading) {
    return <div className="min-h-screen bg-black" />;
  }

  // Not authenticated — show landing / login screen
  if (!session) {
    return <LoginPage />;
  }

  // Wait for profile to load before deciding whether to show onboarding
  if (!profileLoaded) {
    return <div className="min-h-screen bg-black" />;
  }

  // First-open onboarding walkthrough — keeps showing until user checks "Don't show again"
  if (!onboardingCompleted || showOnboarding) {
    const handleComplete = async (dontShowAgain: boolean) => {
      setShowOnboarding(false);
      if (dontShowAgain) {
        setOnboardingCompleted(true);
        try {
          await completeOnboarding();
        } catch { /* ignore */ }
      }
    };
    return <Onboarding onComplete={handleComplete} />;
  }

  const switchView = (v: View) => {
    setEditPlanId(null);
    setDashboardId(null);
    setSlideDir(v === 'home' ? 'right' : 'left');
    setView(v);
    if (v === 'home') navigate('/');
  };

  const openDashboard = (planId: string) => setDashboardId(planId);
  const closeDashboard = () => {
    setDashboardId(null);
    navigate('/');
  };

  const handleEditPlan = (planId: string) => {
    setDashboardId(null);
    setView('home');
    setSlideDir('right');
    setEditPlanId(planId);
  };

  const finishEditing = (planId: string) => {
    setEditPlanId(null);
    setDashboardId(planId);
  };

  const shellProps = {
    view,
    onChangeView: switchView,
    unreadCount,
    onOpenNotifications: () => setShowNotifications(true),
  };

  if (editPlanId) {
    return (
      <Shell {...shellProps} isEditingItinerary>
        <HomePage
          editPlanId={editPlanId}
          onNavigateToDashboard={finishEditing}
          onCancelEdit={() => {
            setEditPlanId(null);
            setDashboardId(editPlanId);
          }}
        />
      </Shell>
    );
  }

  if (dashboardId) {
    return (
      <Shell {...shellProps}>
        <DashboardPage id={dashboardId} onBack={closeDashboard} onEditPlan={handleEditPlan} />
      </Shell>
    );
  }

  if (showNotifications) {
    return (
      <Shell {...shellProps}>
        <NotificationsPage onBack={() => { setShowNotifications(false); refreshUnread(); }} />
      </Shell>
    );
  }

  return (
    <Shell {...shellProps}>
      <div key={view} className={`animate-slide-${slideDir}`}>
        {view === 'home' ? (
          <HomePage onNavigateToDashboard={openDashboard} />
        ) : view === 'events' ? (
          <EventsPage onOpenPlan={openDashboard} />
        ) : view === 'friends' ? (
          <FriendsPage />
        ) : view === 'settings' ? (
          <SettingsPage onBack={() => switchView('home')} />
        ) : (
          <VenuesPage />
        )}
      </div>
    </Shell>
  );
}

function App() {
  return (
    <div className="app-shell">
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </div>
  );
}

export default App;
