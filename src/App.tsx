import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useRouter, navigate } from './lib/router';
import { clearPlanDraft } from './lib/draft';
import { AuthProvider, useAuth } from './context/AuthContext';
import { HomeDashboard } from './pages/HomeDashboard';
import { UnifiedPlanner } from './pages/UnifiedPlanner';
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
import { MainNavigation, type AppView } from './components/MainNavigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './components/ui/dialog';
import { SHARE_RECEIVED, takeSharedLink } from './lib/shareTarget';
import { nativeShare, type AndroidShare } from './lib/aiSave';
import { AndroidShareSheet, PendingAndroidSharePlan } from './components/AndroidShareSheet';
import { Capacitor } from '@capacitor/core';
import { stagingSupabase } from './lib/publicRecommendation.js';
import { AiSaveDialog } from './components/AiSaveDialog';
import { PendingVenuePlan, PublicVenuePage } from './pages/PublicVenue';
import { categoryOf, savedCandidate, venueKey, type PlannerMode, type PlannerVenue } from './lib/planner';
import type { SharedVenue } from './lib/aiSave';
import { GuidedTour } from './components/GuidedTour';
import { CreditPrompt } from './components/CreditPrompt';
import { fetchUnreadNotificationCount, subscribeToPush, completeOnboarding, updateDietaryPreferences, isSigningUp } from './lib/supabase';
import { Bell, Settings } from 'lucide-react';

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

type View = AppView;

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
  guard,
  inlineNotifications = false,
}: {
  children: React.ReactNode;
  view: View;
  onChangeView: (v: View) => void;
  unreadCount: number;
  onOpenNotifications: () => void;
  isEditingItinerary?: boolean;
  guard?: React.ReactNode;
  inlineNotifications?: boolean;
}) {
  return (
    <>
      <div className="app-main">
        <div className="app-canvas">{children}</div>
      </div>

      {/* Hidden while editing an itinerary: leaving would drop unsaved edits. */}
      {!isEditingItinerary && !inlineNotifications && <button
        onClick={onOpenNotifications}
        className="fixed right-4 top-4 z-50 flex size-11 items-center justify-center rounded-full border border-border bg-card text-primary-text shadow-1 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 sm:right-5 sm:top-5"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>}

      {view !== 'home' && view !== 'planner' && view !== 'discover' && !isEditingItinerary && <button aria-label="Settings" onClick={() => onChangeView('settings')} className="ux-icon fixed right-16 top-4 z-40"><Settings size={19} /></button>}
      <MainNavigation view={view} onChange={onChangeView} />
      {guard}
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
  const [plannerMode, setPlannerMode] = useState<PlannerMode | undefined>();
  const [plannerSeed, setPlannerSeed] = useState<PlannerVenue[]>([]);
  const [plannerCollection, setPlannerCollection] = useState('');
  const [plannerDirty, setPlannerDirty] = useState(false);
  const [pendingView, setPendingView] = useState<View | null>(null);
  const [pendingPlannerVenue, setPendingPlannerVenue] = useState<PlannerVenue>();
  const [openSave, setOpenSave] = useState(false);
  const [venueSaveVersion, setVenueSaveVersion] = useState(0);
  const [incomingShare, setIncomingShare] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const { onboardingCompleted, setOnboardingCompleted, profileLoaded, passwordRecovery, username, dietaryPreferences, refreshProfile, premiumUnlocked } = useAuth();
  useEffect(() => {
    if (!session || incomingShare) return;
    const consume = () => {
      const shared = takeSharedLink();
      if (shared) setIncomingShare(shared);
    };
    consume();
    window.addEventListener(SHARE_RECEIVED, consume);
    return () => window.removeEventListener(SHARE_RECEIVED, consume);
  }, [session, incomingShare]);
  useEffect(() => { if (view !== 'venues') setOpenSave(false); }, [view]);

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
      setView('events');
    } else if (route.name === 'home') {
      setDashboardId(null);
      setView('home');
    } else if (route.name === 'events' || route.name === 'friends' || route.name === 'settings' || route.name === 'planner' || route.name === 'discover') {
      setDashboardId(null); setView(route.name);
    } else if (route.name === 'create' || route.name === 'build') {
      setDashboardId(null); setView('planner');
    } else if (route.name === 'venues') {
      // Deep link (e.g. from a shared-collection notification). The Venues
      // page reads any ?collection= param itself.
      setDashboardId(null);
      setEditPlanId(null);
      setView('venues');
    } else if (route.name === 'my-venues') {
      // Old links: sponsored venues are in Admin now.
      navigate('/admin');
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
  if (route.name === 'public-venue') return <PublicVenuePage key={route.id} id={route.id} />;

  // Venue partner portal + subscription — require auth
  if (route.name === 'venue-portal') {
    if (!session) return <LoginPage />;
    return <VenuePortalPage onBack={() => navigate('/')} />;
  }
  if (route.name === 'subscription') {
    if (!session) return <LoginPage />;
    if (import.meta.env.VITE_SUPABASE_URL === stagingSupabase && (!profileLoaded || premiumUnlocked)) {
      return <main className="p-6"><p>Subscriptions are paused during testing.</p><button className="btn-outline mt-4" onClick={() => navigate('/')}>Go home</button></main>;
    }
    return <SubscriptionPage onBack={() => navigate('/')} />;
  }
  // Blank screen while session loads — avoids flash of login page for returning users
  if (authLoading) {
    return <div className="min-h-screen bg-background" />;
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
    return <div className="min-h-screen bg-background" />;
  }

  // Anyone without a username (a first Google sign-in, or an older email
  // account) picks one, unless an email sign-up is saving it right now.
  if (!username && !isSigningUp()) {
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

  const applyView = (v: View) => {
    setEditPlanId(null);
    setDashboardId(null);
    setShowNotifications(false);
    setSlideDir(v === 'home' ? 'right' : 'left');
    setView(v);
    if (v === 'planner' && view !== 'planner') {
      setPlannerMode(undefined);
      setPlannerSeed([]);
      setPlannerCollection('');
    }
    if (v === 'home') {
      // Remount Home to refresh its statistics; planner drafts remain saved.
      setHomeResetKey((k) => k + 1);
      navigate('/');
    } else navigate(`/${v}`);
  };
  const switchView = (v: View) => {
    if (editPlanId || (plannerDirty && (view === 'planner' || view === 'discover') && v !== view)) { setPendingView(v); return; }
    applyView(v);
  };
  const startPlanner = (mode?: PlannerMode, seed?: PlannerVenue, collection = '') => {
    applyView('planner');
    setPlannerMode(mode); setPlannerSeed(seed ? [seed] : []); setPlannerCollection(collection);
    setHomeResetKey((k) => k + 1);
  };
  const planFromShare = (venue: SharedVenue) => {
    const stop: PlannerVenue = {
      id: `shared:${venueKey(venue)}`,
      name: venue.name, address: venue.address, link: venue.link, category: categoryOf(venue),
      lat: venue.lat ?? null, lon: venue.lon ?? null, tags: venue.tags ?? [],
      source: 'external', entityKind: 'venue',
    };
    setIncomingShare(null);
    if (editPlanId || plannerDirty) {
      setPendingPlannerVenue(stop);
      setPendingView('planner');
      return;
    }
    startPlanner('saved', stop);
  };
  const closePlannerGuard = () => { setPendingView(null); setPendingPlannerVenue(undefined); };

  const openDashboard = (planId: string) => {
    setDashboardId(planId);
    setView('events');
    navigate(`/plan/${planId}/dashboard`);
  };
  const closeDashboard = () => {
    setDashboardId(null);
    navigate('/');
  };

  const handleEditPlan = (planId: string) => {
    setDashboardId(null);
    setView('planner');
    setSlideDir('right');
    setEditPlanId(planId);
  };

  const finishEditing = (planId: string) => {
    setEditPlanId(null);
    openDashboard(planId);
  };

  const shellProps = {
    view,
    onChangeView: switchView,
    unreadCount,
    onOpenNotifications: () => setShowNotifications(true),
    guard: <>
      <Dialog open={pendingView !== null} onOpenChange={open => { if (!open) closePlannerGuard(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Leave your planner?</DialogTitle><DialogDescription>Your new-event draft is kept on this device. Unsaved edits to an existing event will be discarded.</DialogDescription></DialogHeader>
          <button className="btn-primary" onClick={() => {
            closePlannerGuard();
            setPlannerDirty(false);
            if (pendingPlannerVenue) startPlanner('saved', pendingPlannerVenue);
            else if (pendingView) applyView(pendingView);
          }}>Leave planner</button>
          <button className="btn-outline" onClick={closePlannerGuard}>Keep planning</button>
        </DialogContent>
      </Dialog>
      {incomingShare && <AiSaveDialog key={incomingShare} link={incomingShare}
        onClose={() => setIncomingShare(null)} onPlan={planFromShare}
        onSaved={() => setVenueSaveVersion(version => version + 1)} />}
    </>,
  };

  if (editPlanId) {
    return (
      <Shell {...shellProps} isEditingItinerary>
        <UnifiedPlanner key={editPlanId}
          editPlanId={editPlanId}
          onDone={finishEditing}
          onDirty={setPlannerDirty}
          onCancel={() => {
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

  // The admin dashboard (managers and the super admin; the page and the
  // server both check the role), inside the app with the menu.
  if (route.name === 'admin') {
    return (
      <Shell {...shellProps}>
        <AdminPage tab={route.tab} onBack={() => navigate('/')} />
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

  return (
    <Shell {...shellProps} inlineNotifications={view === 'home'}>
      {tourActive && !incomingShare && <GuidedTour initialDietary={dietaryPreferences} onFinish={finishTour} />}
      {!tourActive && <PendingVenuePlan onPlan={planFromShare} />}
      {!tourActive && Capacitor.getPlatform() === 'android' && <PendingAndroidSharePlan owner={session.user.id} onPlan={planFromShare} />}
      <div key={view === 'home' ? `home-${homeResetKey}` : view} className={`animate-slide-${slideDir}`}>
        {view === 'home' ? (
          <HomeDashboard onPlan={(mode, seed) => startPlanner(mode, seed ? savedCandidate(seed) : undefined)} onVenues={() => switchView('venues')} onEvent={openDashboard}
            onEvents={() => switchView('events')} onSettings={() => switchView('settings')}
            unreadCount={unreadCount} onNotifications={shellProps.onOpenNotifications} onSave={() => { setOpenSave(true); switchView('venues'); }} />
        ) : view === 'planner' || view === 'discover' ? (
          <UnifiedPlanner key={`${view}-${homeResetKey}`} mode={view === 'discover' ? 'ai' : plannerMode} seed={view === 'discover' ? undefined : plannerSeed} collectionId={view === 'discover' ? undefined : plannerCollection}
            onDirty={setPlannerDirty} onDone={(id) => { setPlannerDirty(false); openDashboard(id); }} onCancel={() => { setPlannerDirty(false); applyView('home'); }} />
        ) : view === 'events' ? (
          <EventsPage onOpenPlan={openDashboard} onPlan={() => startPlanner()} />
        ) : view === 'friends' ? (
          <FriendsPage />
        ) : view === 'settings' ? (
          <SettingsPage onBack={() => switchView('home')} onFriends={() => switchView('friends')} />
        ) : (
          <VenuesPage saveVersion={venueSaveVersion} initialAdd={openSave} onSaveLink={setIncomingShare} onPlan={(v) => startPlanner('saved', savedCandidate(v))}
            onPlanCollection={(id) => startPlanner('saved', undefined, id)} />
        )}
      </div>
    </Shell>
  );
}

function App() {
  const android = Capacitor.getPlatform() === 'android';
  const [share, setShare] = useState<AndroidShare | null | undefined>(android ? undefined : null);
  useEffect(() => {
    if (!android) return;
    document.documentElement.classList.add('android-share-window');
    let active = true;
    const show = (value: Partial<AndroidShare>) => {
      if (!active) return;
      if (value.id) setShare({ ...value, id: value.id });
      else {
        document.documentElement.classList.remove('android-share-window');
        setShare(null);
      }
    };
    void nativeShare.getShare().then(show).catch(() => show({}));
    return () => {
      active = false;
      document.documentElement.classList.remove('android-share-window');
    };
  }, [android]);
  if (share === undefined) return null;
  if (share) return <AuthProvider compact><AndroidShareSheet initialShare={share} /><CreditPrompt /></AuthProvider>;

  return (
    <div className="app-shell">
      <AuthProvider>
        {/* Shown for the moment a page that loads on demand is downloading. */}
        <Suspense fallback={<div className="min-h-screen bg-background" />}>
          <AppInner />
        </Suspense>
        {/* Offers a credit for one more AI use once today's free ones are gone. */}
        <CreditPrompt />
      </AuthProvider>
    </div>
  );
}

export default App;
