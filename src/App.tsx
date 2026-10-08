import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useRouter, navigate } from './lib/router';
import { clearPlanDraft } from './lib/draft';
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
import { FriendsPage } from './pages/Friends';
import { NotificationsPage } from './pages/Notifications';
import { ViewToggle } from './components/ViewToggle';
import { GuidedTour } from './components/GuidedTour';
import { fetchUnreadNotificationCount, subscribeToPush, completeOnboarding, updateDietaryPreferences } from './lib/supabase';
import { Bell } from 'lucide-react';

/*
  Pages most people rarely open (admin, venue portal, subscription and its
  Stripe code, trips, password reset) download only when opened, so the app
  everyone starts with is smaller and shows sooner.
*/
const ResetPasswordPage = lazy(() => import('./pages/ResetPassword').then((m) => ({ default: m.ResetPasswordPage })));
const ChooseUsernamePage = lazy(() => import('./pages/ChooseUsername').then((m) => ({ default: m.ChooseUsernamePage })));
const SharePage = lazy(() => import('./pages/PlanView').then((m) => ({ default: m.SharePage })));
const TripSetupPage = lazy(() => import('./pages/TripSetup').then((m) => ({ default: m.TripSetupPage })));
const TripOverviewPage = lazy(() => import('./pages/TripOverview').then((m) => ({ default: m.TripOverviewPage })));
const TripRsvpPage = lazy(() => import('./pages/TripRsvp').then((m) => ({ default: m.TripRsvpPage })));
const TripDayPage = lazy(() => import('./pages/TripDay').then((m) => ({ default: m.TripDayPage })));
const VenuePortalPage = lazy(() => import('./pages/VenuePortal').then((m) => ({ default: m.VenuePortalPage })));
const AdminPage = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminPage })));
const SubscriptionPage = lazy(() => import('./pages/Subscription').then((m) => ({ default: m.SubscriptionPage })));

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

      {/* Hidden while editing an itinerary: leaving would drop unsaved edits. */}
      {!isEditingItinerary && <button
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
      </button>}

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
  const [homeResetKey, setHomeResetKey] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const { onboardingCompleted, setOnboardingCompleted, profileLoaded, passwordRecovery, username, dietaryPreferences, refreshProfile } = useAuth();

  // The walkthrough runs over the app until it's finished or skipped, and
  // again after Settings → Replay Walkthrough. It points at Home's buttons,
  // so it starts from the Home start screen wherever the app was.
  const tourActive = !!session && profileLoaded && !onboardingCompleted && !passwordRecovery;
  useEffect(() => {
    if (!tourActive) return;
    setEditPlanId(null);
    setDashboardId(null);
    setShowNotifications(false);
    setView('home');
    clearPlanDraft();
    setHomeResetKey((k) => k + 1);
  }, [tourActive]);

  useEffect(() => {
    // Any navigation (including a notification tap) leaves the notifications list.
    setShowNotifications(false);
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

  // An event's invitation and RSVP pages. Someone without the app gets them on
  // their own; someone signed in (opening an invite from Events or a
  // notification) gets them inside the app, with the menu, further down.
  const planPage =
    route.name === 'rsvp' ? <RsvpPage id={route.id} />
    : route.name === 'confirmed' ? <ConfirmedPage id={route.id} />
    : route.name === 'declined' ? <DeclinedPage id={route.id} />
    : route.name === 'share' ? <SharePage id={route.id} />
    : null;
  if (planPage && !authLoading && !session) return planPage;
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
  // Staff and admins only; the page and the server both check the role.
  if (route.name === 'admin') {
    if (!session) return <LoginPage />;
    return <AdminPage onBack={() => navigate('/')} />;
  }

  // Blank screen while session loads — avoids flash of login page for returning users
  if (authLoading) {
    return <div className="min-h-screen bg-black" />;
  }

  // Not authenticated — show landing / login screen
  if (!session) {
    return <LoginPage />;
  }

  // Opened from a password-reset email: the new password comes first.
  if (passwordRecovery) {
    return <ResetPasswordPage />;
  }

  // Wait for profile to load before deciding whether to show onboarding
  if (!profileLoaded) {
    return <div className="min-h-screen bg-black" />;
  }

  // Google/Facebook accounts arrive without a username; ask for one once.
  const provider = session.user.app_metadata?.provider;
  if (!username && provider && provider !== 'email') {
    return <ChooseUsernamePage />;
  }

  // Done or skipped: off for good (until replayed). Dietary picks from the
  // last step are saved with it.
  const finishTour = async (dietary: string[] | null) => {
    setOnboardingCompleted(true);
    try {
      await completeOnboarding();
      if (dietary) {
        await updateDietaryPreferences(dietary);
        await refreshProfile();
      }
    } catch { /* ignore */ }
  };

  const switchView = (v: View) => {
    setEditPlanId(null);
    setDashboardId(null);
    setShowNotifications(false);
    setSlideDir(v === 'home' ? 'right' : 'left');
    setView(v);
    if (v === 'home') {
      // Home always means the start screen, even mid-wizard or after sharing
      // a plan: drop the saved draft and remount the page.
      clearPlanDraft();
      setHomeResetKey((k) => k + 1);
      navigate('/');
    } else if (planPage) {
      // Leaving an invitation for another tab.
      navigate('/');
    }
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

  // Above the dashboard so the bell works there too; Back returns to it.
  if (showNotifications) {
    return (
      <Shell {...shellProps}>
        <NotificationsPage
          onBack={() => { setShowNotifications(false); refreshUnread(); }}
          onOpenFriends={() => { switchView('friends'); refreshUnread(); }}
        />
      </Shell>
    );
  }

  // Signed in: an invitation or RSVP page, inside the app with the menu.
  if (planPage) {
    return <Shell {...shellProps}>{planPage}</Shell>;
  }

  if (dashboardId) {
    return (
      <Shell {...shellProps}>
        <DashboardPage id={dashboardId} onBack={closeDashboard} onEditPlan={handleEditPlan} />
      </Shell>
    );
  }

  return (
    <Shell {...shellProps}>
      {tourActive && <GuidedTour initialDietary={dietaryPreferences} onFinish={finishTour} />}
      <div key={view === 'home' ? `home-${homeResetKey}` : view} className={`animate-slide-${slideDir}`}>
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
        {/* Shown for the moment a page that loads on demand is downloading. */}
        <Suspense fallback={<div className="min-h-screen bg-black" />}>
          <AppInner />
        </Suspense>
      </AuthProvider>
    </div>
  );
}

export default App;
