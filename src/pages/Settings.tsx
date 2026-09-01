import { useState, useEffect } from 'react';
import { ChevronLeft, User, Mail, Lock, LogOut, Check, AtSign, HelpCircle, Utensils, Building2, Crown, ChevronRight } from 'lucide-react';
import { signOut, upsertProfile, updateUserEmail, updateUserPassword, checkUsernameAvailable, resetOnboarding, updateDietaryPreferences, SUBSCRIPTION_PLANS } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { navigate } from '../lib/router';
import { ScrollHint } from '../components/ScrollHint';

const DIETARY_OPTIONS = [
  { key: 'vegetarian', label: 'Vegetarian' },
  { key: 'vegan', label: 'Vegan' },
  { key: 'gluten-free', label: 'Gluten-Free' },
  { key: 'halal', label: 'Halal' },
  { key: 'kosher', label: 'Kosher' },
  { key: 'dairy-free', label: 'Dairy-Free' },
  { key: 'nut-allergy', label: 'Nut Allergy' },
  { key: 'pescatarian', label: 'Pescatarian' },
];

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const { session, displayName, username, refreshProfile, setOnboardingCompleted, dietaryPreferences, subscriptionTier, isVenuePartner } = useAuth();
  const currentEmail = session?.user.email ?? '';

  const [dietarySelections, setDietarySelections] = useState<Set<string>>(new Set(dietaryPreferences));
  const [dietarySaving, setDietarySaving] = useState(false);
  const [dietarySaved, setDietarySaved] = useState(false);

  const [nameInput, setNameInput] = useState(displayName ?? '');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  const [usernameInput, setUsernameInput] = useState(username ?? '');
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSaved, setUsernameSaved] = useState(false);

  const [emailInput, setEmailInput] = useState(currentEmail);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSaved, setEmailSaved] = useState(false);

  const [passwordInput, setPasswordInput] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  useEffect(() => {
    setNameInput(displayName ?? '');
  }, [displayName]);

  useEffect(() => {
    setUsernameInput(username ?? '');
  }, [username]);

  useEffect(() => {
    setDietarySelections(new Set(dietaryPreferences));
  }, [dietaryPreferences]);

  const handleSaveName = async () => {
    if (!nameInput.trim()) {
      setNameError('Display name is required.');
      return;
    }
    setNameSaving(true);
    setNameError(null);
    try {
      await upsertProfile(nameInput.trim(), username ?? undefined);
      await refreshProfile();
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2500);
    } catch (e) {
      setNameError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setNameSaving(false);
    }
  };

  const handleSaveUsername = async () => {
    const clean = usernameInput.trim().replace(/^@/, '').toLowerCase();
    if (!clean) {
      setUsernameError('Username is required.');
      return;
    }
    setUsernameSaving(true);
    setUsernameError(null);
    try {
      const available = await checkUsernameAvailable(clean);
      if (!available) {
        setUsernameError('That username is already taken.');
        setUsernameSaving(false);
        return;
      }
      await upsertProfile(displayName ?? 'User', clean);
      await refreshProfile();
      setUsernameSaved(true);
      setTimeout(() => setUsernameSaved(false), 2500);
    } catch (e) {
      setUsernameError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setUsernameSaving(false);
    }
  };

  const handleSaveEmail = async () => {
    if (!emailInput.trim()) {
      setEmailError('Email is required.');
      return;
    }
    setEmailSaving(true);
    setEmailError(null);
    try {
      await updateUserEmail(emailInput.trim());
      setEmailSaved(true);
      setTimeout(() => setEmailSaved(false), 8000);
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : 'Failed to update email.');
    } finally {
      setEmailSaving(false);
    }
  };

  const handleSavePassword = async () => {
    if (passwordInput.length < 6) {
      setPasswordError('Password must be at least 6 characters.');
      return;
    }
    setPasswordSaving(true);
    setPasswordError(null);
    try {
      await updateUserPassword(passwordInput);
      setPasswordInput('');
      setPasswordSaved(true);
      setTimeout(() => setPasswordSaved(false), 2500);
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : 'Failed to update password.');
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
    } catch {
      // ignore — AuthContext will clear session anyway
    }
  };

  return (
    <div className="relative min-h-screen overflow-y-auto bg-black px-6 pt-20 pb-24">
      <button
        onClick={onBack}
        aria-label="Back"
        className="absolute left-5 top-5 flex items-center justify-center rounded-full text-gold transition-all active:scale-90"
      >
        <ChevronLeft size={28} strokeWidth={2.5} />
      </button>

      <div className="mx-auto w-full">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 mb-8 text-sm text-ink-secondary">{currentEmail}</p>

        {/* Display name */}
        <section className="mb-6 rounded-card border border-gold/20 bg-[#111] p-5">
          <h2 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gold/70">
            <User size={13} /> Display Name
          </h2>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="e.g. Robert Bui"
            className="mb-3 w-full rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
          />
          {nameError && (
            <p className="mb-3 text-sm text-danger">{nameError}</p>
          )}
          <button
            onClick={handleSaveName}
            disabled={nameSaving}
            className="flex w-full items-center justify-center gap-2 rounded-card bg-gold py-3 text-sm font-bold text-black shadow-gold-glow transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {nameSaved ? <><Check size={15} /> Saved!</> : nameSaving ? 'Saving...' : 'Save Name'}
          </button>
        </section>

        {/* Username */}
        <section className="mb-6 rounded-card border border-gold/20 bg-[#111] p-5">
          <h2 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gold/70">
            <AtSign size={13} /> Username
          </h2>
          <div className="relative mb-3">
            <AtSign size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold/50" />
            <input
              type="text"
              value={usernameInput}
              onChange={(e) => {
                const clean = e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
                setUsernameInput(clean);
              }}
              placeholder="e.g. robbui"
              className="w-full rounded-card border border-gold/20 bg-black/40 py-3 pl-11 pr-4 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
            />
          </div>
          {usernameError && (
            <p className="mb-3 text-sm text-danger">{usernameError}</p>
          )}
          <button
            onClick={handleSaveUsername}
            disabled={usernameSaving || !usernameInput.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-card bg-gold py-3 text-sm font-bold text-black shadow-gold-glow transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {usernameSaved ? <><Check size={15} /> Saved!</> : usernameSaving ? 'Saving...' : 'Save Username'}
          </button>
          <p className="mt-2 text-xs text-ink-secondary">Friends can find you by searching this username.</p>
        </section>

        {/* Dietary Preferences */}
        <section className="mb-6 rounded-card border border-gold/20 bg-[#111] p-5">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gold/70">
            <Utensils size={13} /> Dietary Preferences
          </h2>
          <p className="mb-4 text-sm text-ink-secondary">
            We use these to filter AI venue recommendations so they always work for you.
          </p>
          <div className="mb-4 flex flex-wrap gap-2">
            {DIETARY_OPTIONS.map((opt) => {
              const selected = dietarySelections.has(opt.key);
              return (
                <button
                  key={opt.key}
                  onClick={() => {
                    setDietarySelections((prev) => {
                      const next = new Set(prev);
                      if (next.has(opt.key)) next.delete(opt.key);
                      else next.add(opt.key);
                      return next;
                    });
                    setDietarySaved(false);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition-all duration-200 active:scale-95 ${
                    selected
                      ? 'border-gold bg-gold text-black'
                      : 'border-gold/30 bg-black/40 text-gold hover:border-gold/60'
                  }`}
                >
                  {selected && <Check size={14} strokeWidth={3} />}
                  {opt.label}
                </button>
              );
            })}
          </div>
          <button
            onClick={async () => {
              setDietarySaving(true);
              try {
                await updateDietaryPreferences(Array.from(dietarySelections));
                await refreshProfile();
                setDietarySaved(true);
                setTimeout(() => setDietarySaved(false), 2500);
              } catch (e) {
                console.error('Failed to save dietary preferences', e);
              } finally {
                setDietarySaving(false);
              }
            }}
            disabled={dietarySaving}
            className="flex w-full items-center justify-center gap-2 rounded-card bg-gold py-3 text-sm font-bold text-black shadow-gold-glow transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {dietarySaved ? <><Check size={15} /> Saved!</> : dietarySaving ? 'Saving...' : 'Save Preferences'}
          </button>
        </section>

        {/* Email */}
        <section className="mb-6 rounded-card border border-gold/20 bg-[#111] p-5">
          <h2 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gold/70">
            <Mail size={13} /> Email Address
          </h2>
          <input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            autoComplete="email"
            className="mb-3 w-full rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
          />
          {emailError && (
            <p className="mb-3 text-sm text-danger">{emailError}</p>
          )}
          {emailSaved && (
            <p className="mb-3 text-sm text-success">
              Check your new email for a confirmation link.
            </p>
          )}
          <button
            onClick={handleSaveEmail}
            disabled={emailSaving}
            className="flex w-full items-center justify-center gap-2 rounded-card bg-gold py-3 text-sm font-bold text-black shadow-gold-glow transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {emailSaving ? 'Saving...' : 'Save Email'}
          </button>
        </section>

        {/* Password */}
        <section className="mb-8 rounded-card border border-gold/20 bg-[#111] p-5">
          <h2 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gold/70">
            <Lock size={13} /> Change Password
          </h2>
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            placeholder="New password (min. 6 characters)"
            autoComplete="new-password"
            className="mb-3 w-full rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
          />
          {passwordError && (
            <p className="mb-3 text-sm text-danger">{passwordError}</p>
          )}
          <button
            onClick={handleSavePassword}
            disabled={passwordSaving}
            className="flex w-full items-center justify-center gap-2 rounded-card bg-gold py-3 text-sm font-bold text-black shadow-gold-glow transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {passwordSaved ? <><Check size={15} /> Updated!</> : passwordSaving ? 'Saving...' : 'Save Password'}
          </button>
        </section>

        {/* Subscription */}
        <section className="mb-6 rounded-card border border-gold/20 bg-[#111] p-5">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gold/70">
            <Crown size={13} /> Subscription
          </h2>
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm text-ink-secondary">Current plan</span>
            <span className="text-sm font-bold text-gold">{SUBSCRIPTION_PLANS[subscriptionTier].label}</span>
          </div>
          <button
            onClick={() => navigate('/subscription')}
            className="flex w-full items-center justify-between rounded-card border border-gold/40 bg-black/40 px-4 py-3 text-sm font-bold text-gold transition-all active:scale-[0.98] hover:bg-gold/10"
          >
            <span className="flex items-center gap-2"><Crown size={16} /> Manage Subscription</span>
            <ChevronRight size={18} />
          </button>
        </section>

        {/* Venue Partner Portal */}
        <section className="mb-6 rounded-card border border-gold/20 bg-[#111] p-5">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gold/70">
            <Building2 size={13} /> Venue Partner
          </h2>
          <p className="mb-4 text-sm text-ink-secondary">
            {isVenuePartner ? 'Manage your venue promotion and billing.' : 'Are you a venue business? Promote your spot and pay only for confirmed visits.'}
          </p>
          <button
            onClick={() => navigate('/venue-portal')}
            className="flex w-full items-center justify-between rounded-card border border-gold/40 bg-black/40 px-4 py-3 text-sm font-bold text-gold transition-all active:scale-[0.98] hover:bg-gold/10"
          >
            <span className="flex items-center gap-2"><Building2 size={16} /> {isVenuePartner ? 'Venue Dashboard' : 'Become a Venue Partner'}</span>
            <ChevronRight size={18} />
          </button>
        </section>

        {/* Replay onboarding */}
        <section className="mb-6 rounded-card border border-gold/20 bg-[#111] p-5">
          <h2 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gold/70">
            <HelpCircle size={13} /> How to Use
          </h2>
          <p className="mb-3 text-sm text-ink-secondary">
            New here or need a refresher? Replay the quick walkthrough.
          </p>
          <button
            onClick={async () => {
              try {
                await resetOnboarding();
                setOnboardingCompleted(false);
              } catch { /* ignore */ }
            }}
            className="flex w-full items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/40 py-3 text-sm font-bold text-gold transition-all active:scale-[0.98] hover:bg-gold/10"
          >
            Replay Walkthrough
          </button>
        </section>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-card border border-danger/30 bg-danger/10 py-3.5 text-base font-bold text-danger transition-all active:scale-[0.98] hover:bg-danger/20"
        >
          <LogOut size={18} /> Sign Out
        </button>
      </div>
      <ScrollHint />
    </div>
  );
}
